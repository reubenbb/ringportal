import 'server-only';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { withAuth } from '@/server/db/client';
import { clubUsers, passwordResetTokens, platformUsers } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { env } from '@/server/env';
import { ApiError } from '@/server/http';
import { sendMail } from '@/server/mail';
import { randomToken, sha256 } from './crypto';
import { hashPassword } from './password';
import { LIMITS, hit, hitAll } from './rate-limit';
import { revokeAllAdminSessions, revokeAllClubUserSessions } from './session';

export type ResetAudience = 'club' | 'admin';
const TTL_MS = 30 * 60_000;

/**
 * Always resolves the same way whether or not the account exists, so the
 * endpoint cannot be used to discover registered emails.
 */
export async function requestPasswordReset(email: string, audience: ResetAudience, meta: { ipHash: string }): Promise<void> {
  const outcome = await withAuth(async (tx) => {
    const rl = await hitAll(tx, [
      [LIMITS.resetRequestIp, meta.ipHash],
      [LIMITS.resetRequestAccount, `${audience}:${email}`],
    ]);
    if (!rl.allowed) {
      await audit(tx, { actorType: 'anonymous', action: 'password_reset.rate_limited', ipHash: meta.ipHash });
      return null;
    }
    const subject =
      audience === 'club'
        ? await tx
            .select({ id: clubUsers.id, status: clubUsers.status, clubId: clubUsers.clubId })
            .from(clubUsers)
            .where(eq(clubUsers.email, email))
            .then((r) => r[0] && { ...r[0], type: 'club_user' as const })
        : await tx
            .select({ id: platformUsers.id, status: platformUsers.status })
            .from(platformUsers)
            .where(eq(platformUsers.email, email))
            .then((r) => r[0] && { ...r[0], clubId: null, type: 'platform_user' as const });
    if (!subject || subject.status !== 'active') {
      await audit(tx, { actorType: 'anonymous', action: 'password_reset.requested_unknown', ipHash: meta.ipHash });
      return null;
    }
    // Only the newest link works.
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.subjectType, subject.type), eq(passwordResetTokens.subjectId, subject.id), isNull(passwordResetTokens.usedAt)));
    const token = randomToken();
    await tx.insert(passwordResetTokens).values({
      subjectType: subject.type,
      subjectId: subject.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    await audit(tx, {
      actorType: subject.type,
      actorId: subject.id,
      clubId: subject.clubId,
      action: 'password_reset.requested',
      ipHash: meta.ipHash,
    });
    return token;
  });
  if (!outcome) return;
  // Token in the URL fragment: never sent to the server, proxies or Referer headers.
  const path = audience === 'club' ? '/reset-password' : '/admin/reset-password';
  const link = `${new URL(env().APP_ORIGIN).origin}${path}#token=${outcome}`;
  const result = await sendMail({
    to: email,
    subject: 'Reset your RingPortal password',
    text: [
      'We received a request to reset your RingPortal password.',
      '',
      `Use this link within 30 minutes: ${link}`,
      '',
      'If you did not ask for this, you can ignore this email. Your password has not changed.',
    ].join('\n'),
  });
  if (!result.delivered) console.warn('[password-reset] reset email not delivered');
}

export async function confirmPasswordReset(token: string, newPassword: string, meta: { ipHash: string }): Promise<ResetAudience> {
  const passwordHash = await hashPassword(newPassword);
  const result = await withAuth(async (tx) => {
    const rl = await hit(tx, LIMITS.resetConfirmIp, meta.ipHash);
    if (!rl.allowed) return { kind: 'limited' as const, retry: rl.retryAfterSeconds };
    const [row] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.tokenHash, sha256(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .returning({ subjectType: passwordResetTokens.subjectType, subjectId: passwordResetTokens.subjectId });
    if (!row) {
      await audit(tx, { actorType: 'anonymous', action: 'password_reset.invalid_token', ipHash: meta.ipHash });
      return { kind: 'invalid' as const };
    }
    if (row.subjectType === 'club_user') {
      const [u] = await tx
        .update(clubUsers)
        .set({ passwordHash, passwordChangedAt: new Date() })
        .where(and(eq(clubUsers.id, row.subjectId), eq(clubUsers.status, 'active')))
        .returning({ clubId: clubUsers.clubId });
      if (!u) return { kind: 'invalid' as const };
      const revoked = await revokeAllClubUserSessions(tx, row.subjectId);
      await audit(tx, {
        actorType: 'club_user',
        actorId: row.subjectId,
        clubId: u.clubId,
        action: 'password_reset.completed',
        metadata: { revokedSessions: revoked },
        ipHash: meta.ipHash,
      });
      return { kind: 'ok' as const, audience: 'club' as const };
    }
    const updated = await tx
      .update(platformUsers)
      .set({ passwordHash, passwordChangedAt: new Date() })
      .where(and(eq(platformUsers.id, row.subjectId), eq(platformUsers.status, 'active')))
      .returning({ id: platformUsers.id });
    if (!updated.length) return { kind: 'invalid' as const };
    // Resetting a password never bypasses MFA: the next sign-in still needs a second factor.
    const revoked = await revokeAllAdminSessions(tx, row.subjectId);
    await audit(tx, {
      actorType: 'platform_user',
      actorId: row.subjectId,
      action: 'password_reset.completed',
      metadata: { revokedSessions: revoked },
      ipHash: meta.ipHash,
    });
    return { kind: 'ok' as const, audience: 'admin' as const };
  });
  if (result.kind === 'limited') throw new ApiError('rate_limited', 'Too many attempts. Try again later.', undefined, result.retry);
  if (result.kind === 'invalid') throw new ApiError('bad_request', 'This reset link is invalid or has expired. Request a new one.');
  return result.audience;
}
