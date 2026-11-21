import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { withClub, type Tx } from '@/server/db/client';
import { clubBlocks } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import type { ClubSession } from '@/server/auth/session';
import { clubNames, type ClubName } from '@/server/cross-club';

type Meta = { ipHash: string };

/** 'mine' = this club blocked the other; 'theirs' = the other club blocked this one. */
export type BlockState = 'none' | 'mine' | 'theirs';

export async function blockState(tx: Tx, me: string, other: string): Promise<BlockState> {
  const [own] = await tx.select({ id: clubBlocks.blockedClubId }).from(clubBlocks).where(and(eq(clubBlocks.blockerClubId, me), eq(clubBlocks.blockedClubId, other)));
  if (own) return 'mine';
  const res = await tx.execute<{ b: boolean }>(sql`select blocked_with(${other}::uuid) as b`);
  return res.rows[0]?.b ? 'theirs' : 'none';
}

/** Throws if the two clubs may not contact each other. The message never reveals who blocked whom beyond your own block. */
export async function assertNotBlocked(tx: Tx, me: string, other: string): Promise<void> {
  const state = await blockState(tx, me, other);
  if (state === 'mine') throw new ApiError('conflict', 'You have blocked this club. Unblock it from its profile to contact it again.');
  if (state === 'theirs') throw new ApiError('conflict', 'You cannot contact this club.');
}

export function getBlockState(session: ClubSession, other: string): Promise<BlockState> {
  return withClub(session.clubId, (tx) => blockState(tx, session.clubId, other));
}

export async function blockClub(session: ClubSession, other: string, meta: Meta): Promise<void> {
  if (other === session.clubId) throw new ApiError('bad_request', 'You cannot block your own club');
  const ok = await withClub(session.clubId, async (tx) => {
    const club = (await clubNames(tx, [other])).get(other);
    if (!club) return false;
    await tx.insert(clubBlocks).values({ blockerClubId: session.clubId, blockedClubId: other }).onConflictDoNothing();
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'club.blocked', targetType: 'club', targetId: other, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Club not found');
}

export async function unblockClub(session: ClubSession, other: string, meta: Meta): Promise<void> {
  await withClub(session.clubId, async (tx) => {
    const res = await tx.delete(clubBlocks).where(and(eq(clubBlocks.blockerClubId, session.clubId), eq(clubBlocks.blockedClubId, other))).returning({ id: clubBlocks.blockedClubId });
    if (res.length) await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'club.unblocked', targetType: 'club', targetId: other, ipHash: meta.ipHash });
  });
}

export async function listMyBlocks(session: ClubSession): Promise<(ClubName & { blockedAt: string })[]> {
  return withClub(session.clubId, async (tx) => {
    const rows = await tx.select().from(clubBlocks).where(eq(clubBlocks.blockerClubId, session.clubId)).orderBy(desc(clubBlocks.createdAt));
    const names = await clubNames(tx, rows.map((r) => r.blockedClubId));
    return rows.map((r) => ({ ...(names.get(r.blockedClubId) ?? { id: r.blockedClubId, name: 'Club no longer listed', slug: '', isDemo: false, approved: false }), blockedAt: r.createdAt.toISOString() }));
  });
}
