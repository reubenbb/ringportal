import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { withAuth } from '@/server/db/client';
import type { Tx } from '@/server/db/client';
import { platformMfaChallenges, platformUsers } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { randomToken, sha256 } from './crypto';
import {
  consumeRecoveryCode,
  enrolmentPayload,
  issueRecoveryCodes,
  matchTotp,
  newTotpSecret,
  openTotpSecret,
  remainingRecoveryCodes,
  sealTotpSecret,
  verifyAndConsumeTotp,
} from './mfa';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { LIMITS, hit, hitAll } from './rate-limit';
import { createAdminSession, revokeAdminSessionByToken, revokeAllAdminSessions, SESSION_POLICY, type AdminSession } from './session';

type RequestMeta = { ipHash: string; userAgent: string | null };
const MAX_MFA_ATTEMPTS = 5;
const INVALID = 'Email or password is incorrect';

/** Step 1: password. Never creates a session; issues a short-lived second-factor challenge. */
export async function adminPasswordStep(
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<{ challengeToken: string; next: 'mfa' | 'enrol' }> {
  const result = await withAuth(async (tx) => {
    const rl = await hitAll(tx, [
      [LIMITS.adminLoginIp, meta.ipHash],
      [LIMITS.adminLoginAccount, input.email],
    ]);
    if (!rl.allowed) {
      await audit(tx, { actorType: 'anonymous', action: 'admin.login_rate_limited', ipHash: meta.ipHash });
      return { kind: 'limited' as const, retry: rl.retryAfterSeconds };
    }
    const [user] = await tx
      .select({ id: platformUsers.id, hash: platformUsers.passwordHash, status: platformUsers.status, mfaEnabledAt: platformUsers.mfaEnabledAt })
      .from(platformUsers)
      .where(eq(platformUsers.email, input.email))
      .limit(1);
    if (!user) {
      await burnPasswordCheck(input.password);
      await audit(tx, { actorType: 'anonymous', action: 'admin.login_failed', metadata: { reason: 'unknown_account' }, ipHash: meta.ipHash });
      return { kind: 'invalid' as const };
    }
    const valid = await verifyPassword(user.hash, input.password);
    if (!valid || user.status !== 'active') {
      await audit(tx, {
        actorType: 'platform_user',
        actorId: user.id,
        action: 'admin.login_failed',
        metadata: { reason: valid ? 'account_disabled' : 'bad_password' },
        ipHash: meta.ipHash,
      });
      return { kind: 'invalid' as const };
    }
    const challengeToken = randomToken();
    await tx.insert(platformMfaChallenges).values({
      platformUserId: user.id,
      tokenHash: sha256(challengeToken),
      expiresAt: new Date(Date.now() + SESSION_POLICY.admin_mfa.absoluteMs),
    });
    await audit(tx, { actorType: 'platform_user', actorId: user.id, action: 'admin.password_verified', ipHash: meta.ipHash });
    return { kind: 'ok' as const, challengeToken, next: user.mfaEnabledAt ? ('mfa' as const) : ('enrol' as const) };
  });
  if (result.kind === 'limited') throw new ApiError('rate_limited', 'Too many attempts. Try again later.', undefined, result.retry);
  if (result.kind === 'invalid') throw new ApiError('unauthenticated', INVALID);
  return { challengeToken: result.challengeToken, next: result.next };
}

async function loadChallenge(tx: Tx, token: string) {
  const [c] = await tx
    .select({
      id: platformMfaChallenges.id,
      platformUserId: platformMfaChallenges.platformUserId,
      attempts: platformMfaChallenges.attempts,
      email: platformUsers.email,
      status: platformUsers.status,
      mfaEnabledAt: platformUsers.mfaEnabledAt,
      pending: platformUsers.mfaPendingSecretEnc,
    })
    .from(platformMfaChallenges)
    .innerJoin(platformUsers, eq(platformUsers.id, platformMfaChallenges.platformUserId))
    .where(
      and(
        eq(platformMfaChallenges.tokenHash, sha256(token)),
        isNull(platformMfaChallenges.consumedAt),
        gt(platformMfaChallenges.expiresAt, new Date()),
      ),
    )
    .for('update', { of: platformMfaChallenges })
    .limit(1);
  if (!c || c.status !== 'active') return null;
  return c;
}

const consume = (tx: Tx, id: string) =>
  tx.update(platformMfaChallenges).set({ consumedAt: new Date() }).where(eq(platformMfaChallenges.id, id));

type MfaOutcome =
  | { kind: 'ok'; sessionToken: string }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'limited'; retry: number };

function throwMfa(o: Exclude<MfaOutcome, { kind: 'ok' }>): never {
  if (o.kind === 'limited') throw new ApiError('rate_limited', 'Too many attempts. Try again later.', undefined, o.retry);
  if (o.kind === 'expired') throw new ApiError('unauthenticated', 'Your sign-in has expired. Start again.');
  throw new ApiError('validation_failed', 'That code is not valid', { code: 'That code is not valid' });
}

/** Step 2: TOTP code or a single-use recovery code. */
export async function adminMfaStep(
  challengeToken: string,
  input: { code?: string; recoveryCode?: string },
  meta: RequestMeta,
): Promise<string> {
  const result: MfaOutcome = await withAuth(async (tx) => {
    const rl = await hit(tx, LIMITS.adminMfaIp, meta.ipHash);
    if (!rl.allowed) return { kind: 'limited', retry: rl.retryAfterSeconds };
    const c = await loadChallenge(tx, challengeToken);
    if (!c || !c.mfaEnabledAt) return { kind: 'expired' };
    if (c.attempts >= MAX_MFA_ATTEMPTS) {
      await consume(tx, c.id);
      return { kind: 'expired' };
    }
    await tx.update(platformMfaChallenges).set({ attempts: c.attempts + 1 }).where(eq(platformMfaChallenges.id, c.id));
    let method: 'totp' | 'recovery_code' | null = null;
    if (input.code && (await verifyAndConsumeTotp(tx, c.platformUserId, input.code))) method = 'totp';
    else if (input.recoveryCode && (await consumeRecoveryCode(tx, c.platformUserId, input.recoveryCode))) method = 'recovery_code';
    if (!method) {
      await audit(tx, { actorType: 'platform_user', actorId: c.platformUserId, action: 'admin.mfa_failed', ipHash: meta.ipHash });
      return { kind: 'invalid' };
    }
    await consume(tx, c.id);
    const sessionToken = await createAdminSession(tx, { platformUserId: c.platformUserId, ...meta });
    await tx.update(platformUsers).set({ lastLoginAt: new Date() }).where(eq(platformUsers.id, c.platformUserId));
    const remaining = method === 'recovery_code' ? await remainingRecoveryCodes(tx, c.platformUserId) : undefined;
    await audit(tx, {
      actorType: 'platform_user',
      actorId: c.platformUserId,
      action: 'admin.login',
      metadata: { method, ...(remaining !== undefined ? { recoveryCodesRemaining: remaining } : {}) },
      ipHash: meta.ipHash,
    });
    return { kind: 'ok', sessionToken };
  });
  if (result.kind !== 'ok') throwMfa(result);
  return result.sessionToken;
}

/** First sign-in for an account without MFA: generate a pending secret. Re-calling replaces it. */
export async function adminEnrolmentStart(challengeToken: string): Promise<{ uri: string; qrSvg: string; secret: string }> {
  const result = await withAuth(async (tx) => {
    const c = await loadChallenge(tx, challengeToken);
    if (!c || c.mfaEnabledAt) return null;
    const secret = newTotpSecret();
    await tx.update(platformUsers).set({ mfaPendingSecretEnc: sealTotpSecret(c.platformUserId, secret) }).where(eq(platformUsers.id, c.platformUserId));
    return { email: c.email, secret };
  });
  if (!result) throw new ApiError('unauthenticated', 'Your sign-in has expired. Start again.');
  return enrolmentPayload(result.email, result.secret);
}

export async function adminEnrolmentConfirm(
  challengeToken: string,
  code: string,
  meta: RequestMeta,
): Promise<{ sessionToken: string; recoveryCodes: string[] }> {
  const result = await withAuth(async (tx) => {
    const rl = await hit(tx, LIMITS.adminMfaIp, meta.ipHash);
    if (!rl.allowed) return { kind: 'limited' as const, retry: rl.retryAfterSeconds };
    const c = await loadChallenge(tx, challengeToken);
    if (!c || c.mfaEnabledAt || !c.pending) return { kind: 'expired' as const };
    if (c.attempts >= MAX_MFA_ATTEMPTS) {
      await consume(tx, c.id);
      return { kind: 'expired' as const };
    }
    await tx.update(platformMfaChallenges).set({ attempts: c.attempts + 1 }).where(eq(platformMfaChallenges.id, c.id));
    const step = matchTotp(openTotpSecret(c.platformUserId, c.pending), code);
    if (step === null) return { kind: 'invalid' as const };
    await tx
      .update(platformUsers)
      .set({ mfaSecretEnc: c.pending, mfaPendingSecretEnc: null, mfaEnabledAt: new Date(), mfaLastStep: step, lastLoginAt: new Date() })
      .where(eq(platformUsers.id, c.platformUserId));
    const recoveryCodes = await issueRecoveryCodes(tx, c.platformUserId);
    await consume(tx, c.id);
    const sessionToken = await createAdminSession(tx, { platformUserId: c.platformUserId, ...meta });
    await audit(tx, { actorType: 'platform_user', actorId: c.platformUserId, action: 'admin.mfa_enrolled', ipHash: meta.ipHash });
    await audit(tx, { actorType: 'platform_user', actorId: c.platformUserId, action: 'admin.login', metadata: { method: 'enrolment' }, ipHash: meta.ipHash });
    return { kind: 'ok' as const, sessionToken, recoveryCodes };
  });
  if (result.kind !== 'ok') throwMfa(result);
  return { sessionToken: result.sessionToken, recoveryCodes: result.recoveryCodes };
}

export async function adminLogout(token: string, meta: RequestMeta): Promise<void> {
  await withAuth(async (tx) => {
    const id = await revokeAdminSessionByToken(tx, token);
    if (id) await audit(tx, { actorType: 'platform_user', action: 'admin.logout', targetType: 'platform_session', targetId: id, ipHash: meta.ipHash });
  });
}

// Signed-in account security ------------------------------------------------

async function requireCurrentTotp(tx: Tx, admin: AdminSession, code: string, meta: RequestMeta) {
  const rl = await hit(tx, LIMITS.sensitiveAction, `admin:${admin.platformUserId}`);
  if (!rl.allowed) return { kind: 'limited' as const, retry: rl.retryAfterSeconds };
  if (!(await verifyAndConsumeTotp(tx, admin.platformUserId, code))) {
    await audit(tx, { actorType: 'platform_user', actorId: admin.platformUserId, action: 'admin.step_up_failed', ipHash: meta.ipHash });
    return { kind: 'invalid' as const };
  }
  return null;
}

export async function regenerateRecoveryCodes(admin: AdminSession, code: string, meta: RequestMeta): Promise<string[]> {
  const result = await withAuth(async (tx) => {
    const fail = await requireCurrentTotp(tx, admin, code, meta);
    if (fail) return fail;
    const codes = await issueRecoveryCodes(tx, admin.platformUserId);
    await audit(tx, { actorType: 'platform_user', actorId: admin.platformUserId, action: 'admin.recovery_codes_regenerated', ipHash: meta.ipHash });
    return { kind: 'ok' as const, codes };
  });
  if (result.kind !== 'ok') throwMfa(result);
  return result.codes;
}

export async function startMfaRotation(admin: AdminSession, code: string, meta: RequestMeta) {
  const result = await withAuth(async (tx) => {
    const fail = await requireCurrentTotp(tx, admin, code, meta);
    if (fail) return fail;
    const secret = newTotpSecret();
    await tx.update(platformUsers).set({ mfaPendingSecretEnc: sealTotpSecret(admin.platformUserId, secret) }).where(eq(platformUsers.id, admin.platformUserId));
    await audit(tx, { actorType: 'platform_user', actorId: admin.platformUserId, action: 'admin.mfa_rotation_started', ipHash: meta.ipHash });
    return { kind: 'ok' as const, secret };
  });
  if (result.kind !== 'ok') throwMfa(result);
  return enrolmentPayload(admin.email, result.secret);
}

export async function confirmMfaRotation(admin: AdminSession, newCode: string, meta: RequestMeta): Promise<{ revokedOtherSessions: number }> {
  const result = await withAuth(async (tx) => {
    const rl = await hit(tx, LIMITS.sensitiveAction, `admin:${admin.platformUserId}`);
    if (!rl.allowed) return { kind: 'limited' as const, retry: rl.retryAfterSeconds };
    const [u] = await tx.select({ pending: platformUsers.mfaPendingSecretEnc }).from(platformUsers).where(eq(platformUsers.id, admin.platformUserId)).for('update');
    if (!u?.pending) return { kind: 'expired' as const };
    const step = matchTotp(openTotpSecret(admin.platformUserId, u.pending), newCode);
    if (step === null) return { kind: 'invalid' as const };
    await tx
      .update(platformUsers)
      .set({ mfaSecretEnc: u.pending, mfaPendingSecretEnc: null, mfaEnabledAt: new Date(), mfaLastStep: step })
      .where(eq(platformUsers.id, admin.platformUserId));
    const revoked = await revokeAllAdminSessions(tx, admin.platformUserId, admin.sessionId);
    await audit(tx, {
      actorType: 'platform_user',
      actorId: admin.platformUserId,
      action: 'admin.mfa_rotated',
      metadata: { revokedOtherSessions: revoked },
      ipHash: meta.ipHash,
    });
    return { kind: 'ok' as const, revoked };
  });
  if (result.kind !== 'ok') throwMfa(result);
  return { revokedOtherSessions: result.revoked };
}

export async function changeAdminPassword(
  admin: AdminSession,
  input: { currentPassword: string; newPassword: string },
  meta: RequestMeta,
): Promise<{ revokedOtherSessions: number }> {
  const newHash = await hashPassword(input.newPassword);
  const result = await withAuth(async (tx) => {
    const rl = await hit(tx, LIMITS.passwordChange, `admin:${admin.platformUserId}`);
    if (!rl.allowed) return { kind: 'limited' as const, retry: rl.retryAfterSeconds };
    const [u] = await tx.select({ hash: platformUsers.passwordHash }).from(platformUsers).where(eq(platformUsers.id, admin.platformUserId)).for('update');
    if (!u || !(await verifyPassword(u.hash, input.currentPassword))) {
      await audit(tx, { actorType: 'platform_user', actorId: admin.platformUserId, action: 'admin.password_change_failed', ipHash: meta.ipHash });
      return { kind: 'invalid' as const };
    }
    if (input.currentPassword === input.newPassword) return { kind: 'same' as const };
    await tx.update(platformUsers).set({ passwordHash: newHash, passwordChangedAt: new Date() }).where(eq(platformUsers.id, admin.platformUserId));
    const revoked = await revokeAllAdminSessions(tx, admin.platformUserId, admin.sessionId);
    await audit(tx, {
      actorType: 'platform_user',
      actorId: admin.platformUserId,
      action: 'admin.password_changed',
      metadata: { revokedOtherSessions: revoked },
      ipHash: meta.ipHash,
    });
    return { kind: 'ok' as const, revoked };
  });
  if (result.kind === 'limited') throw new ApiError('rate_limited', 'Too many attempts. Try again later.', undefined, result.retry);
  if (result.kind === 'invalid') throw new ApiError('validation_failed', 'Check the highlighted fields', { currentPassword: 'Current password is incorrect' });
  if (result.kind === 'same') throw new ApiError('validation_failed', 'Check the highlighted fields', { newPassword: 'Choose a different password' });
  return { revokedOtherSessions: result.revoked };
}

export async function adminSecuritySummary(admin: AdminSession): Promise<{ recoveryCodesRemaining: number; mfaEnabledAt: string | null }> {
  return withAuth(async (tx) => {
    const [u] = await tx.select({ mfaEnabledAt: platformUsers.mfaEnabledAt }).from(platformUsers).where(eq(platformUsers.id, admin.platformUserId));
    return {
      recoveryCodesRemaining: await remainingRecoveryCodes(tx, admin.platformUserId),
      mfaEnabledAt: u?.mfaEnabledAt?.toISOString() ?? null,
    };
  });
}
