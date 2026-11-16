import 'server-only';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { withAuth, withClub } from '@/server/db/client';
import { clubSessions, clubUsers } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { LIMITS, hit, hitAll } from './rate-limit';
import { createClubSession, revokeAllClubUserSessions, revokeClubSessionByToken, type ClubSession } from './session';

type RequestMeta = { ipHash: string; userAgent: string | null };

const INVALID = 'Email or password is incorrect';

/**
 * Club sign-in. Work is done inside one transaction that always commits, so
 * rate-limit counters and failure audit entries persist even when sign-in fails.
 */
export async function clubLogin(input: { email: string; password: string }, meta: RequestMeta): Promise<string> {
  const result = await withAuth(async (tx) => {
    const rl = await hitAll(tx, [
      [LIMITS.clubLoginIp, meta.ipHash],
      [LIMITS.clubLoginAccount, input.email],
    ]);
    if (!rl.allowed) {
      await audit(tx, { actorType: 'anonymous', action: 'club.login_rate_limited', ipHash: meta.ipHash });
      return { kind: 'limited' as const, retry: rl.retryAfterSeconds };
    }
    const [user] = await tx
      .select({ id: clubUsers.id, clubId: clubUsers.clubId, hash: clubUsers.passwordHash, status: clubUsers.status })
      .from(clubUsers)
      .where(eq(clubUsers.email, input.email))
      .limit(1);
    if (!user) {
      await burnPasswordCheck(input.password);
      await audit(tx, { actorType: 'anonymous', action: 'club.login_failed', metadata: { reason: 'unknown_account' }, ipHash: meta.ipHash });
      return { kind: 'invalid' as const };
    }
    const valid = await verifyPassword(user.hash, input.password);
    if (!valid || user.status !== 'active') {
      await audit(tx, {
        actorType: 'club_user',
        actorId: user.id,
        clubId: user.clubId,
        action: 'club.login_failed',
        metadata: { reason: valid ? 'account_disabled' : 'bad_password' },
        ipHash: meta.ipHash,
      });
      return { kind: 'invalid' as const };
    }
    const token = await createClubSession(tx, { clubUserId: user.id, clubId: user.clubId, ...meta });
    await tx.update(clubUsers).set({ lastLoginAt: new Date() }).where(eq(clubUsers.id, user.id));
    await audit(tx, { actorType: 'club_user', actorId: user.id, clubId: user.clubId, action: 'club.login', ipHash: meta.ipHash });
    return { kind: 'ok' as const, token };
  });
  if (result.kind === 'limited') throw new ApiError('rate_limited', 'Too many attempts. Try again later.', undefined, result.retry);
  if (result.kind === 'invalid') throw new ApiError('unauthenticated', INVALID);
  return result.token;
}

export async function clubLogout(token: string, meta: RequestMeta): Promise<void> {
  await withAuth(async (tx) => {
    const s = await revokeClubSessionByToken(tx, token);
    if (s) {
      await audit(tx, {
        actorType: 'club_user',
        actorId: s.clubUserId,
        clubId: s.clubId,
        action: 'club.logout',
        targetType: 'club_session',
        targetId: s.id,
        ipHash: meta.ipHash,
      });
    }
  });
}

export async function changeClubPassword(
  session: ClubSession,
  input: { currentPassword: string; newPassword: string },
  meta: RequestMeta,
): Promise<{ revokedOtherSessions: number }> {
  const result = await withClub(session.clubId, async (tx) => {
    const rl = await hit(tx, LIMITS.passwordChange, `club_user:${session.clubUserId}`);
    if (!rl.allowed) return { kind: 'limited' as const, retry: rl.retryAfterSeconds };
    const [user] = await tx
      .select({ hash: clubUsers.passwordHash })
      .from(clubUsers)
      .where(eq(clubUsers.id, session.clubUserId))
      .for('update');
    if (!user || !(await verifyPassword(user.hash, input.currentPassword))) {
      await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'club.password_change_failed', ipHash: meta.ipHash });
      return { kind: 'invalid' as const };
    }
    if (input.currentPassword === input.newPassword) return { kind: 'same' as const };
    await tx
      .update(clubUsers)
      .set({ passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() })
      .where(eq(clubUsers.id, session.clubUserId));
    const revoked = await revokeAllClubUserSessions(tx, session.clubUserId, session.sessionId);
    await audit(tx, {
      actorType: 'club_user',
      actorId: session.clubUserId,
      clubId: session.clubId,
      action: 'club.password_changed',
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

export type SessionSummary = { id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; current: boolean };

export async function listClubSessions(session: ClubSession): Promise<SessionSummary[]> {
  return withClub(session.clubId, async (tx) => {
    const rows = await tx
      .select({ id: clubSessions.id, createdAt: clubSessions.createdAt, lastSeenAt: clubSessions.lastSeenAt, userAgent: clubSessions.userAgent })
      .from(clubSessions)
      .where(and(eq(clubSessions.clubUserId, session.clubUserId), isNull(clubSessions.revokedAt), gt(clubSessions.expiresAt, new Date())))
      .orderBy(desc(clubSessions.lastSeenAt))
      .limit(50);
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      userAgent: r.userAgent,
      current: r.id === session.sessionId,
    }));
  });
}

export async function revokeClubSession(session: ClubSession, sessionId: string, meta: RequestMeta): Promise<void> {
  const found = await withClub(session.clubId, async (tx) => {
    const rows = await tx
      .update(clubSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(clubSessions.id, sessionId), eq(clubSessions.clubUserId, session.clubUserId), isNull(clubSessions.revokedAt)))
      .returning({ id: clubSessions.id });
    if (rows.length) {
      await audit(tx, {
        actorType: 'club_user',
        actorId: session.clubUserId,
        clubId: session.clubId,
        action: 'club.session_revoked',
        targetType: 'club_session',
        targetId: sessionId,
        ipHash: meta.ipHash,
      });
    }
    return rows.length > 0;
  });
  // Same response for "not yours" and "does not exist" so IDs cannot be probed.
  if (!found) throw new ApiError('not_found', 'Session not found');
}
