import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAdmin } from '@/server/db/client';
import { platformRecoveryCodes, platformUsers } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { emailSchema, hashPassword } from '@/server/auth/password';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import { revokeAllAdminSessions, type AdminSession } from '@/server/auth/session';
import { isUniqueViolation } from '@/server/cross-club';

/** Platform administrator accounts. Every function here requires the platform owner. */
type Meta = { ipHash: string };

function assertOwner(actor: AdminSession) {
  if (actor.role !== 'owner') throw new ApiError('forbidden', 'Platform owner permission required');
}

export type AdminUserRow = { id: string; email: string; displayName: string; role: 'owner' | 'admin'; status: 'active' | 'disabled'; mfaEnabled: boolean; lastLoginAt: string | null; isYou: boolean };

export async function listAdminUsers(actor: AdminSession): Promise<AdminUserRow[]> {
  assertOwner(actor);
  return withAdmin(async (tx) => {
    const rows = await tx
      .select({ id: platformUsers.id, email: platformUsers.email, displayName: platformUsers.displayName, role: platformUsers.role, status: platformUsers.status, mfaEnabledAt: platformUsers.mfaEnabledAt, lastLoginAt: platformUsers.lastLoginAt })
      .from(platformUsers)
      .orderBy(asc(platformUsers.email));
    return rows.map(({ mfaEnabledAt, lastLoginAt, ...r }) => ({ ...r, mfaEnabled: Boolean(mfaEnabledAt), lastLoginAt: lastLoginAt?.toISOString() ?? null, isYou: r.id === actor.platformUserId }));
  });
}

export const createAdminSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(2, 'Enter their name').max(80),
  role: z.enum(['admin', 'owner'], { error: 'Choose a role' }),
});

/**
 * Creates an administrator with a random one-time password, returned once and never
 * stored in readable form or logged. Two-factor setup is forced at their first sign-in.
 */
export async function createAdminUser(actor: AdminSession, input: z.infer<typeof createAdminSchema>, meta: Meta): Promise<{ id: string; temporaryPassword: string }> {
  assertOwner(actor);
  const temporaryPassword = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  try {
    return await withAdmin(async (tx) => {
      const r = await hit(tx, LIMITS.sensitiveAction, `admin-users:${actor.platformUserId}`);
      if (!r.allowed) throw new ApiError('rate_limited', 'Too many changes. Please wait a few minutes.', undefined, r.retryAfterSeconds);
      const [u] = await tx.insert(platformUsers).values({ email: input.email, displayName: input.displayName, passwordHash, role: input.role }).returning({ id: platformUsers.id });
      await audit(tx, { actorType: 'platform_user', actorId: actor.platformUserId, action: 'admin.account_created', targetType: 'platform_user', targetId: u!.id, metadata: { role: input.role }, ipHash: meta.ipHash });
      return { id: u!.id, temporaryPassword };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'platform_users_email_unique')) throw new ApiError('validation_failed', 'Check the highlighted fields', { email: 'An administrator with this email already exists' });
    throw err;
  }
}

export const adminUserActionSchema = z.object({
  action: z.enum(['disable', 'enable', 'reset_mfa']),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});

export async function actOnAdminUser(actor: AdminSession, id: string, input: z.infer<typeof adminUserActionSchema>, meta: Meta): Promise<void> {
  assertOwner(actor);
  if (id === actor.platformUserId) throw new ApiError('conflict', 'You cannot change your own account here. Use Account security, or ask another owner.');
  const ok = await withAdmin(async (tx) => {
    const [u] = await tx.select({ id: platformUsers.id, role: platformUsers.role, status: platformUsers.status }).from(platformUsers).where(eq(platformUsers.id, id)).for('update');
    if (!u) return false;
    let revoked = 0;
    if (input.action === 'disable') {
      if (u.role === 'owner') {
        // Lock every active owner first, so two owners disabling each other at the same time
        // are serialised and cannot leave the platform with no active owner.
        await tx.execute(sql`select id from platform_users where role = 'owner' and status = 'active' order by id for update`);
        const [others] = await tx.select({ n: sql<number>`count(*)::int` }).from(platformUsers).where(and(eq(platformUsers.role, 'owner'), eq(platformUsers.status, 'active'), ne(platformUsers.id, id)));
        if (!Number(others?.n)) throw new ApiError('conflict', 'This is the only active owner account.');
      }
      await tx.update(platformUsers).set({ status: 'disabled' }).where(eq(platformUsers.id, id));
      revoked = await revokeAllAdminSessions(tx, id);
    } else if (input.action === 'enable') {
      await tx.update(platformUsers).set({ status: 'active' }).where(eq(platformUsers.id, id));
    } else {
      await tx.update(platformUsers).set({ mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null }).where(eq(platformUsers.id, id));
      await tx.delete(platformRecoveryCodes).where(eq(platformRecoveryCodes.platformUserId, id));
      revoked = await revokeAllAdminSessions(tx, id);
    }
    const action = input.action === 'disable' ? 'admin.account_disabled' : input.action === 'enable' ? 'admin.account_enabled' : 'admin.mfa_reset';
    await audit(tx, { actorType: 'platform_user', actorId: actor.platformUserId, action, targetType: 'platform_user', targetId: id, reason: input.reason, metadata: { revokedSessions: revoked }, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Administrator not found');
}
