import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAdmin } from '@/server/db/client';
import { auditLog, clubClaims, clubUsers, clubs, directoryClubs, governingBodies } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import type { AdminSession } from '@/server/auth/session';
import type { ClubStatus } from '@/lib/club-status';
import { CLUB_ACTIONS, type ClubAction } from '@/lib/club-admin';
import { boxerCards } from '@/server/cross-club';

export const CLUBS_PAGE = 50;
export type ClubFilter = 'review' | 'approved' | 'attention' | 'closed' | 'all';
export const CLUB_FILTERS: readonly ClubFilter[] = ['review', 'approved', 'attention', 'closed', 'all'];

const FILTER_SQL: Record<ClubFilter, ReturnType<typeof sql>> = {
  review: sql`(c.status in ('submitted', 'under_review') or exists (select 1 from club_claims k where k.club_id = c.id and k.status = 'pending'))`,
  approved: sql`c.status = 'approved'`,
  attention: sql`(c.status = 'reverification_required' or (c.status = 'approved' and c.affiliation_expires_on < current_date))`,
  closed: sql`c.status in ('rejected', 'suspended', 'draft')`,
  all: sql`true`,
};

export type AdminClubRow = {
  id: string; name: string; status: ClubStatus; isDemo: boolean; governingBody: string; affiliationNumber: string | null;
  affiliationExpiresOn: string | null; affiliationExpired: boolean; createdAt: string; pendingClaim: string | null; boxers: number;
};

export async function listClubsForAdmin(opts: { filter: ClubFilter; q?: string; page?: number }): Promise<{ rows: AdminClubRow[]; total: number; counts: Record<ClubFilter, number> }> {
  return withAdmin(async (tx) => {
    const page = Math.max(1, opts.page ?? 1);
    const q = opts.q?.trim().slice(0, 80);
    const search = q ? sql`and c.name ilike ${'%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'}` : sql``;
    const res = await tx.execute<{
      id: string; name: string; status: ClubStatus; is_demo: boolean; governing_body: string; affiliation_number: string | null;
      affiliation_expires_on: string | null; expired: boolean; created_at: Date; pending_claim: string | null; boxers: number; total: number;
    }>(sql`
      select c.id, c.name, c.status, c.is_demo, g.name as governing_body, c.affiliation_number, c.affiliation_expires_on::text,
             coalesce(c.affiliation_expires_on < current_date, false) as expired, c.created_at,
             (select d.name from club_claims k join directory_clubs d on d.id = k.directory_club_id where k.club_id = c.id and k.status = 'pending') as pending_claim,
             (select count(*)::int from boxers b where b.club_id = c.id and b.archived_at is null) as boxers,
             count(*) over ()::int as total
      from clubs c join governing_bodies g on g.id = c.governing_body_id
      where ${FILTER_SQL[opts.filter]} ${search}
      order by case when c.status in ('submitted', 'under_review') then 0 else 1 end, c.created_at desc, c.id
      limit ${CLUBS_PAGE} offset ${(page - 1) * CLUBS_PAGE}`);
    const c = await tx.execute<Record<ClubFilter, number>>(sql`
      select count(*) filter (where ${FILTER_SQL.review})::int as review, count(*) filter (where ${FILTER_SQL.approved})::int as approved,
             count(*) filter (where ${FILTER_SQL.attention})::int as attention, count(*) filter (where ${FILTER_SQL.closed})::int as closed, count(*)::int as "all"
      from clubs c`);
    return {
      rows: res.rows.map((r) => ({
        id: r.id, name: r.name, status: r.status, isDemo: r.is_demo, governingBody: r.governing_body, affiliationNumber: r.affiliation_number,
        affiliationExpiresOn: r.affiliation_expires_on, affiliationExpired: r.expired, createdAt: new Date(r.created_at).toISOString(), pendingClaim: r.pending_claim, boxers: Number(r.boxers),
      })),
      total: Number(res.rows[0]?.total ?? 0),
      counts: c.rows[0]!,
    };
  });
}

export type AdminClubDetail = {
  id: string; name: string; slug: string; status: ClubStatus; statusReason: string | null; statusChangedAt: string; isDemo: boolean; governingBody: string; region: string | null;
  affiliationNumber: string | null; affiliationExpiresOn: string | null; createdAt: string;
  logins: { email: string; status: string; lastLoginAt: string | null }[];
  claims: { id: string; status: 'pending' | 'approved' | 'rejected'; createdAt: string; directoryClubId: string; directoryName: string; directoryRegion: string | null; directoryPostcode: string | null; directoryClaimedByOther: boolean }[];
  counts: { boxers: number; proposals: number; confirmedBouts: number; conversations: number };
  history: { occurredAt: string; action: string; reason: string | null; actorType: string }[];
  proposals: { id: string; status: string; version: number; otherClub: string; boxers: string; weightKg: number; proposedDate: string | null; updatedAt: string }[];
};

export async function getClubForAdmin(id: string): Promise<AdminClubDetail | null> {
  return withAdmin(async (tx) => {
    const [c] = await tx
      .select({
        id: clubs.id, name: clubs.name, slug: clubs.slug, status: clubs.status, statusReason: clubs.statusReason, statusChangedAt: clubs.statusChangedAt, isDemo: clubs.isDemo,
        governingBody: governingBodies.name, region: clubs.region, affiliationNumber: clubs.affiliationNumber, affiliationExpiresOn: clubs.affiliationExpiresOn, createdAt: clubs.createdAt,
      })
      .from(clubs)
      .innerJoin(governingBodies, eq(governingBodies.id, clubs.governingBodyId))
      .where(eq(clubs.id, id));
    if (!c) return null;
    const logins = await tx.select({ email: clubUsers.email, status: clubUsers.status, lastLoginAt: clubUsers.lastLoginAt }).from(clubUsers).where(eq(clubUsers.clubId, id));
    const claims = await tx
      .select({
        id: clubClaims.id, status: clubClaims.status, createdAt: clubClaims.createdAt, directoryClubId: directoryClubs.id, directoryName: directoryClubs.name,
        directoryRegion: directoryClubs.region, directoryPostcode: directoryClubs.postcode, linkedClubId: directoryClubs.clubId,
      })
      .from(clubClaims)
      .innerJoin(directoryClubs, eq(directoryClubs.id, clubClaims.directoryClubId))
      .where(eq(clubClaims.clubId, id))
      .orderBy(desc(clubClaims.createdAt));
    const n = await tx.execute<{ boxers: number; proposals: number; confirmed: number; conversations: number }>(sql`
      select (select count(*)::int from boxers where club_id = ${id}::uuid and archived_at is null) as boxers,
             (select count(*)::int from bout_proposals where ${id}::uuid in (proposing_club_id, receiving_club_id)) as proposals,
             (select count(*)::int from bout_proposals where ${id}::uuid in (proposing_club_id, receiving_club_id) and status = 'confirmed') as confirmed,
             (select count(*)::int from conversations where ${id}::uuid in (club_low_id, club_high_id) and last_message_at is not null) as conversations`);
    const history = await tx
      .select({ occurredAt: auditLog.occurredAt, action: auditLog.action, reason: auditLog.reason, actorType: auditLog.actorType })
      .from(auditLog)
      .where(and(eq(auditLog.targetType, 'club'), eq(auditLog.targetId, id)))
      .orderBy(desc(auditLog.id))
      .limit(30);
    const props = await tx.execute<{ id: string; status: string; current_version: number; other: string; a: string; b: string; weight_kg: string; proposed_date: string | null; updated_at: Date }>(sql`
      select p.id, p.status, p.current_version, oc.name as other, p.proposing_boxer_id as a, p.receiving_boxer_id as b, v.weight_kg, v.proposed_date::text, p.updated_at
      from bout_proposals p
      join bout_proposal_versions v on v.proposal_id = p.id and v.version = p.current_version
      join clubs oc on oc.id = case when p.proposing_club_id = ${id}::uuid then p.receiving_club_id else p.proposing_club_id end
      where ${id}::uuid in (p.proposing_club_id, p.receiving_club_id)
      order by p.updated_at desc limit 25`);
    // Admins see the same minimised boxer cards as other clubs (junior surnames shortened).
    const cards = await boxerCards(tx, props.rows.flatMap((r) => [r.a, r.b]));
    const proposals = props.rows.map((r) => ({
      id: r.id, status: r.status, version: Number(r.current_version), otherClub: r.other,
      boxers: `${cards.get(r.a)?.displayName ?? 'Boxer'} v ${cards.get(r.b)?.displayName ?? 'Boxer'}`,
      weightKg: Number(r.weight_kg), proposedDate: r.proposed_date, updatedAt: new Date(r.updated_at).toISOString(),
    }));
    return {
      ...c,
      proposals,
      statusChangedAt: c.statusChangedAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
      logins: logins.map((l) => ({ ...l, lastLoginAt: l.lastLoginAt?.toISOString() ?? null })),
      claims: claims.map(({ linkedClubId, ...k }) => ({ ...k, createdAt: k.createdAt.toISOString(), directoryClaimedByOther: Boolean(linkedClubId && linkedClubId !== id) })),
      counts: { boxers: Number(n.rows[0]!.boxers), proposals: Number(n.rows[0]!.proposals), confirmedBouts: Number(n.rows[0]!.confirmed), conversations: Number(n.rows[0]!.conversations) },
      history: history.map((h) => ({ ...h, occurredAt: h.occurredAt.toISOString() })),
    };
  });
}

const today = () => new Date().toISOString().slice(0, 10);

export const clubDecisionSchema = z.object({
  action: z.enum(Object.keys(CLUB_ACTIONS) as [ClubAction, ...ClubAction[]]),
  reason: z.string().trim().max(500).optional().transform((v) => v || null),
  affiliationExpiresOn: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), 'Enter a valid date'),
  /** Approve the club but turn down its directory claim. */
  rejectClaim: z.boolean().optional(),
});
export type ClubDecision = z.infer<typeof clubDecisionSchema>;

export async function decideClub(admin: AdminSession, id: string, input: ClubDecision, meta: { ipHash: string }): Promise<{ status: ClubStatus }> {
  const spec = CLUB_ACTIONS[input.action];
  if (spec.reasonRequired && (!input.reason || input.reason.length < 5)) {
    throw new ApiError('validation_failed', 'Check the highlighted fields', { reason: 'Give a reason (at least 5 characters). The club will see it.' });
  }
  if (input.action === 'approve' && input.affiliationExpiresOn && input.affiliationExpiresOn < today()) {
    throw new ApiError('validation_failed', 'Check the highlighted fields', { affiliationExpiresOn: 'The affiliation has already expired on this date' });
  }
  const result = await withAdmin(async (tx) => {
    const [c] = await tx.select({ id: clubs.id, status: clubs.status }).from(clubs).where(eq(clubs.id, id)).for('update');
    if (!c) return null;
    if (!(spec.from as readonly ClubStatus[]).includes(c.status)) throw new ApiError('conflict', `This club is ${c.status.replace(/_/g, ' ')}, so it cannot be changed this way. Refresh to see its current status.`);

    let claimOutcome: 'approved' | 'rejected' | null = null;
    const [claim] = await tx.select().from(clubClaims).where(and(eq(clubClaims.clubId, id), eq(clubClaims.status, 'pending'))).for('update');
    if (claim && (input.action === 'approve' || input.action === 'reject')) {
      claimOutcome = input.action === 'approve' && !input.rejectClaim ? 'approved' : 'rejected';
      if (claimOutcome === 'approved') {
        const [d] = await tx.select({ clubId: directoryClubs.clubId, region: directoryClubs.region }).from(directoryClubs).where(eq(directoryClubs.id, claim.directoryClubId)).for('update');
        if (!d || d.clubId) throw new ApiError('conflict', 'The claimed directory record is already linked to another club. Approve without the claim, or reject.');
        await tx.update(directoryClubs).set({ clubId: id, claimStatus: 'claimed' }).where(eq(directoryClubs.id, claim.directoryClubId));
        if (d.region) await tx.update(clubs).set({ region: d.region }).where(eq(clubs.id, id));
      }
      await tx.update(clubClaims).set({ status: claimOutcome, decidedBy: admin.platformUserId, decidedAt: new Date() }).where(eq(clubClaims.id, claim.id));
    }

    await tx
      .update(clubs)
      .set({
        status: spec.to,
        statusReason: input.reason,
        statusChangedAt: new Date(),
        ...(input.action === 'approve' && input.affiliationExpiresOn ? { affiliationExpiresOn: input.affiliationExpiresOn } : {}),
      })
      .where(eq(clubs.id, id));
    await audit(tx, {
      actorType: 'platform_user',
      actorId: admin.platformUserId,
      clubId: id,
      action: `club.${input.action}`,
      targetType: 'club',
      targetId: id,
      reason: input.reason ?? undefined,
      metadata: { from: c.status, to: spec.to, ...(claimOutcome ? { claim: claimOutcome } : {}) },
      ipHash: meta.ipHash,
    });
    return { status: spec.to };
  });
  if (!result) throw new ApiError('not_found', 'Club not found');
  return result;
}

export const clubRegionSchema = z.object({ region: z.string().trim().max(80).optional().nullable().transform((v) => v || null) });

export async function listRegionsForAdmin(): Promise<string[]> {
  return withAdmin(async (tx) => {
    const rows = await tx.selectDistinct({ region: directoryClubs.region }).from(directoryClubs).where(sql`${directoryClubs.region} is not null`).orderBy(directoryClubs.region);
    return rows.map((r) => r.region!);
  });
}

/** Sets or clears a club's region (must be one of the directory's regions). Audited. */
export async function setClubRegion(admin: AdminSession, id: string, region: string | null, meta: { ipHash: string }): Promise<void> {
  const ok = await withAdmin(async (tx) => {
    if (region) {
      const [known] = await tx.select({ id: directoryClubs.id }).from(directoryClubs).where(eq(directoryClubs.region, region)).limit(1);
      if (!known) throw new ApiError('validation_failed', 'Check the highlighted fields', { region: 'Choose a region from the list' });
    }
    const res = await tx.update(clubs).set({ region }).where(eq(clubs.id, id)).returning({ id: clubs.id });
    if (!res.length) return false;
    await audit(tx, { actorType: 'platform_user', actorId: admin.platformUserId, clubId: id, action: 'club.region_set', targetType: 'club', targetId: id, metadata: { region }, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Club not found');
}

/** Decide a pending directory claim on its own (for clubs that are already approved). Audited. */
export async function decideClaim(admin: AdminSession, claimId: string, approve: boolean, meta: { ipHash: string }): Promise<void> {
  const ok = await withAdmin(async (tx) => {
    const [claim] = await tx.select().from(clubClaims).where(eq(clubClaims.id, claimId)).for('update');
    if (!claim) return false;
    if (claim.status !== 'pending') throw new ApiError('conflict', 'This claim has already been decided.');
    if (approve) {
      const [d] = await tx.select({ clubId: directoryClubs.clubId, region: directoryClubs.region }).from(directoryClubs).where(eq(directoryClubs.id, claim.directoryClubId)).for('update');
      if (!d || d.clubId) throw new ApiError('conflict', 'This directory record is already linked to another club.');
      await tx.update(directoryClubs).set({ clubId: claim.clubId, claimStatus: 'claimed' }).where(eq(directoryClubs.id, claim.directoryClubId));
      if (d.region) await tx.update(clubs).set({ region: d.region }).where(eq(clubs.id, claim.clubId));
    }
    await tx.update(clubClaims).set({ status: approve ? 'approved' : 'rejected', decidedBy: admin.platformUserId, decidedAt: new Date() }).where(eq(clubClaims.id, claimId));
    await audit(tx, { actorType: 'platform_user', actorId: admin.platformUserId, clubId: claim.clubId, action: approve ? 'club.claim_approved' : 'club.claim_rejected', targetType: 'club', targetId: claim.clubId, metadata: { claimId, directoryClubId: claim.directoryClubId }, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Claim not found');
}
