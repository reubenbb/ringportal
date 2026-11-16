import 'server-only';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { NextRequest, NextResponse } from 'next/server';
import { withAuth, type Tx } from '@/server/db/client';
import { clubSessions, clubUsers, clubs, platformSessions, platformUsers } from '@/server/db/schema';
import { isProduction } from '@/server/env';
import { randomToken, sha256 } from './crypto';

export type SessionKind = 'club' | 'admin' | 'admin_mfa';

const POLICY = {
  club: { absoluteMs: 14 * 24 * 3600_000, idleMs: 3 * 24 * 3600_000 },
  admin: { absoluteMs: 12 * 3600_000, idleMs: 30 * 60_000 },
  admin_mfa: { absoluteMs: 5 * 60_000, idleMs: 5 * 60_000 },
} as const;
/** Avoid a write on every request; idle expiry tolerates this much slack. */
const TOUCH_INTERVAL_MS = 60_000;

/** __Host- prefix forces Secure, Path=/ and no Domain in production browsers. */
export function cookieName(kind: SessionKind): string {
  const base = { club: 'rp_session', admin: 'rp_admin', admin_mfa: 'rp_admin_mfa' }[kind];
  return isProduction() ? `__Host-${base}` : base;
}

export function setSessionCookie(res: NextResponse, kind: SessionKind, token: string): void {
  res.cookies.set(cookieName(kind), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: kind === 'club' ? 'lax' : 'strict',
    path: '/',
    maxAge: Math.floor(POLICY[kind].absoluteMs / 1000),
    priority: 'high',
  });
}

export function clearSessionCookie(res: NextResponse, kind: SessionKind): void {
  res.cookies.set(cookieName(kind), '', { httpOnly: true, secure: isProduction(), sameSite: 'lax', path: '/', maxAge: 0 });
}

export function readSessionToken(req: Pick<NextRequest, 'cookies'>, kind: SessionKind): string | undefined {
  const value = req.cookies.get(cookieName(kind))?.value;
  return value && value.length >= 32 && value.length <= 128 ? value : undefined;
}

// ---------------------------------------------------------------------------
// Club sessions

export type ClubSession = {
  sessionId: string;
  clubUserId: string;
  clubId: string;
  email: string;
  clubName: string;
  clubSlug: string;
  clubStatus: (typeof clubs.$inferSelect)['status'];
  isDemoClub: boolean;
};

export async function createClubSession(
  tx: Tx,
  input: { clubUserId: string; clubId: string; userAgent: string | null; ipHash: string | null },
): Promise<string> {
  const token = randomToken();
  await tx.insert(clubSessions).values({
    clubUserId: input.clubUserId,
    clubId: input.clubId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + POLICY.club.absoluteMs),
    userAgent: input.userAgent,
    ipHash: input.ipHash,
  });
  return token;
}

/** Resolves a club session from its cookie token. Expired, revoked or disabled sessions resolve to null. */
export async function resolveClubSession(token: string | undefined): Promise<ClubSession | null> {
  if (!token) return null;
  return withAuth(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .select({
        sessionId: clubSessions.id,
        clubUserId: clubSessions.clubUserId,
        clubId: clubSessions.clubId,
        lastSeenAt: clubSessions.lastSeenAt,
        email: clubUsers.email,
        userStatus: clubUsers.status,
        clubName: clubs.name,
        clubSlug: clubs.slug,
        clubStatus: clubs.status,
        isDemoClub: clubs.isDemo,
      })
      .from(clubSessions)
      .innerJoin(clubUsers, eq(clubUsers.id, clubSessions.clubUserId))
      .innerJoin(clubs, eq(clubs.id, clubSessions.clubId))
      .where(and(eq(clubSessions.tokenHash, sha256(token)), isNull(clubSessions.revokedAt), gt(clubSessions.expiresAt, now)))
      .limit(1);
    if (!row || row.userStatus !== 'active') return null;
    if (now.getTime() - row.lastSeenAt.getTime() > POLICY.club.idleMs) {
      await tx.update(clubSessions).set({ revokedAt: now }).where(eq(clubSessions.id, row.sessionId));
      return null;
    }
    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await tx.update(clubSessions).set({ lastSeenAt: now }).where(eq(clubSessions.id, row.sessionId));
    }
    return {
      sessionId: row.sessionId,
      clubUserId: row.clubUserId,
      clubId: row.clubId,
      email: row.email,
      clubName: row.clubName,
      clubSlug: row.clubSlug,
      clubStatus: row.clubStatus,
      isDemoClub: row.isDemoClub,
    };
  });
}

export async function revokeClubSessionByToken(
  tx: Tx,
  token: string,
): Promise<{ id: string; clubUserId: string; clubId: string } | null> {
  const [row] = await tx
    .update(clubSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(clubSessions.tokenHash, sha256(token)), isNull(clubSessions.revokedAt)))
    .returning({ id: clubSessions.id, clubUserId: clubSessions.clubUserId, clubId: clubSessions.clubId });
  return row ?? null;
}

export async function revokeAllClubUserSessions(tx: Tx, clubUserId: string, exceptSessionId?: string): Promise<number> {
  const rows = await tx
    .update(clubSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(clubSessions.clubUserId, clubUserId),
        isNull(clubSessions.revokedAt),
        exceptSessionId ? ne(clubSessions.id, exceptSessionId) : sql`true`,
      ),
    )
    .returning({ id: clubSessions.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Platform (admin) sessions — only ever created after a second factor.

export type AdminSession = {
  sessionId: string;
  platformUserId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin';
};

export async function createAdminSession(
  tx: Tx,
  input: { platformUserId: string; userAgent: string | null; ipHash: string | null },
): Promise<string> {
  const token = randomToken();
  await tx.insert(platformSessions).values({
    platformUserId: input.platformUserId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + POLICY.admin.absoluteMs),
    userAgent: input.userAgent,
    ipHash: input.ipHash,
  });
  return token;
}

export async function resolveAdminSession(token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  return withAuth(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .select({
        sessionId: platformSessions.id,
        platformUserId: platformSessions.platformUserId,
        lastSeenAt: platformSessions.lastSeenAt,
        email: platformUsers.email,
        displayName: platformUsers.displayName,
        role: platformUsers.role,
        status: platformUsers.status,
        mfaEnabledAt: platformUsers.mfaEnabledAt,
      })
      .from(platformSessions)
      .innerJoin(platformUsers, eq(platformUsers.id, platformSessions.platformUserId))
      .where(and(eq(platformSessions.tokenHash, sha256(token)), isNull(platformSessions.revokedAt), gt(platformSessions.expiresAt, now)))
      .limit(1);
    if (!row || row.status !== 'active' || !row.mfaEnabledAt) return null;
    if (now.getTime() - row.lastSeenAt.getTime() > POLICY.admin.idleMs) {
      await tx.update(platformSessions).set({ revokedAt: now }).where(eq(platformSessions.id, row.sessionId));
      return null;
    }
    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await tx.update(platformSessions).set({ lastSeenAt: now }).where(eq(platformSessions.id, row.sessionId));
    }
    return {
      sessionId: row.sessionId,
      platformUserId: row.platformUserId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
    };
  });
}

export async function revokeAdminSessionByToken(tx: Tx, token: string): Promise<string | null> {
  const [row] = await tx
    .update(platformSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(platformSessions.tokenHash, sha256(token)), isNull(platformSessions.revokedAt)))
    .returning({ id: platformSessions.id });
  return row?.id ?? null;
}

export async function revokeAllAdminSessions(tx: Tx, platformUserId: string, exceptSessionId?: string): Promise<number> {
  const rows = await tx
    .update(platformSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(platformSessions.platformUserId, platformUserId),
        isNull(platformSessions.revokedAt),
        exceptSessionId ? ne(platformSessions.id, exceptSessionId) : sql`true`,
      ),
    )
    .returning({ id: platformSessions.id });
  return rows.length;
}

export const SESSION_POLICY = POLICY;
