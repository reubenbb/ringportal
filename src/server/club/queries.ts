import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { withClub } from '@/server/db/client';
import { clubClaims, clubs, directoryClubs, governingBodies } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import { isUniqueViolation } from '@/server/cross-club';
import { ENGLAND_BOXING_ID } from '@/lib/governing-body';
import type { ClubSession } from '@/server/auth/session';

export type ClubOverview = {
  name: string;
  status: (typeof clubs.$inferSelect)['status'];
  statusReason: string | null;
  statusChangedAt: string;
  governingBody: string;
  affiliationNumber: string | null;
  affiliationExpiresOn: string | null;
  isDemo: boolean;
  region: string | null;
  /** Most recent directory claim, if any. */
  claim: { status: 'pending' | 'approved' | 'rejected'; directoryName: string; directorySlug: string } | null;
};

/** Reads through the club's own RLS context: it cannot return another club's row. */
export async function getClubOverview(session: ClubSession): Promise<ClubOverview | null> {
  return withClub(session.clubId, async (tx) => {
    const [row] = await tx
      .select({
        name: clubs.name,
        status: clubs.status,
        statusReason: clubs.statusReason,
        statusChangedAt: clubs.statusChangedAt,
        governingBody: governingBodies.name,
        affiliationNumber: clubs.affiliationNumber,
        affiliationExpiresOn: clubs.affiliationExpiresOn,
        isDemo: clubs.isDemo,
        region: clubs.region,
      })
      .from(clubs)
      .innerJoin(governingBodies, eq(governingBodies.id, clubs.governingBodyId))
      .where(eq(clubs.id, session.clubId));
    if (!row) return null;
    const [claim] = await tx
      .select({ status: clubClaims.status, directoryName: directoryClubs.name, directorySlug: directoryClubs.slug })
      .from(clubClaims)
      .innerJoin(directoryClubs, eq(directoryClubs.id, clubClaims.directoryClubId))
      .where(eq(clubClaims.clubId, session.clubId))
      .orderBy(desc(clubClaims.createdAt))
      .limit(1);
    return { ...row, statusChangedAt: row.statusChangedAt.toISOString(), claim: claim ?? null };
  });
}

/**
 * A registered club asks to claim its England Boxing directory record. The record is
 * linked only if an administrator approves the claim.
 */
export async function requestClaim(session: ClubSession, directoryClubId: string, meta: { ipHash: string }): Promise<void> {
  // Demonstration clubs are fictional and must never be linked to a real club's record.
  if (session.isDemoClub) throw new ApiError('conflict', 'Demonstration clubs cannot claim a directory record.');
  try {
    await withClub(session.clubId, async (tx) => {
      const r = await hit(tx, LIMITS.sensitiveAction, `claim:${session.clubId}`);
      if (!r.allowed) throw new ApiError('rate_limited', 'Too many attempts. Please wait a few minutes.', undefined, r.retryAfterSeconds);
      const [mine] = await tx.select({ id: clubClaims.id }).from(clubClaims).where(and(eq(clubClaims.clubId, session.clubId), inArray(clubClaims.status, ['pending', 'approved'])));
      if (mine) throw new ApiError('conflict', 'Your club already has a directory claim.');
      const [d] = await tx.select({ claimStatus: directoryClubs.claimStatus, governingBodyId: directoryClubs.governingBodyId }).from(directoryClubs).where(eq(directoryClubs.id, directoryClubId));
      if (!d || d.governingBodyId !== ENGLAND_BOXING_ID) throw new ApiError('not_found', 'Directory club not found');
      if (d.claimStatus !== 'unclaimed') throw new ApiError('conflict', 'This club has already been claimed.');
      const [c] = await tx.insert(clubClaims).values({ clubId: session.clubId, directoryClubId }).returning({ id: clubClaims.id });
      await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'club.claim_requested', targetType: 'club', targetId: session.clubId, metadata: { claimId: c!.id, directoryClubId }, ipHash: meta.ipHash });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'club_claims_directory_live_uq')) throw new ApiError('conflict', 'Another club already has a claim on this record waiting for review.');
    if (isUniqueViolation(err, 'club_claims_club_live_uq')) throw new ApiError('conflict', 'Your club already has a directory claim.');
    throw err;
  }
}
