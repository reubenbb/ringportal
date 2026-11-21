import 'server-only';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withClub, type Tx } from '@/server/db/client';
import { boxers, sparringAttendance, sparringOffers, sparringRequests } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import type { ClubSession } from '@/server/auth/session';
import { boxerCards, clubNames, isUniqueViolation, type BoxerCard, type ClubName } from '@/server/cross-club';
import { gate, score } from '@/lib/matchmaking';
import { assertNotBlocked } from '@/server/clubs/blocks';
import { ukToday } from '@/lib/proposals';

/**
 * Individual sparring: one boxer looking for one partner. Deliberately separate
 * from bout proposals (own tables, statuses and screens); no groups or sessions.
 */
type Meta = { ipHash: string };
const text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer`).optional().nullable().transform((v) => v || null);
const SPAR_TOLERANCE_KG = 5;

async function limit(tx: Tx, session: ClubSession) {
  const r = await hit(tx, LIMITS.sensitiveAction, `sparring:${session.clubId}`);
  if (!r.allowed) throw new ApiError('rate_limited', 'Too many changes. Please wait a few minutes.', undefined, r.retryAfterSeconds);
}
const log = (tx: Tx, s: ClubSession, action: string, targetType: string, targetId: string, meta: Meta) =>
  audit(tx, { actorType: 'club_user', actorId: s.clubUserId, clubId: s.clubId, action, targetType, targetId, ipHash: meta.ipHash });

export const sparringRequestSchema = z.object({
  boxerId: z.uuid({ error: 'Choose one of your boxers' }),
  availabilityNote: text(300),
  location: text(160),
  notes: text(1000),
});

export async function createSparringRequest(session: ClubSession, input: z.infer<typeof sparringRequestSchema>, meta: Meta): Promise<{ id: string }> {
  try {
    return await withClub(session.clubId, async (tx) => {
      await limit(tx, session);
      const [b] = await tx.select({ id: boxers.id, availability: boxers.availability }).from(boxers).where(and(eq(boxers.id, input.boxerId), eq(boxers.clubId, session.clubId), isNull(boxers.archivedAt)));
      if (!b) throw new ApiError('validation_failed', 'Check the highlighted fields', { boxerId: 'Choose one of your active boxers' });
      if (b.availability === 'injured_medical' || b.availability === 'inactive') throw new ApiError('validation_failed', 'Check the highlighted fields', { boxerId: 'This boxer is marked injured/medical or inactive' });
      const [r] = await tx.insert(sparringRequests).values({ clubId: session.clubId, ...input }).returning({ id: sparringRequests.id });
      await log(tx, session, 'sparring.request_created', 'sparring_request', r!.id, meta);
      return r!;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'sparring_requests_open_boxer_uq')) throw new ApiError('conflict', 'This boxer already has an open sparring request.');
    throw err;
  }
}

export async function setSparringRequestStatus(session: ClubSession, id: string, status: 'open' | 'closed', meta: Meta): Promise<void> {
  try {
    const ok = await withClub(session.clubId, async (tx) => {
      const [r] = await tx.select({ status: sparringRequests.status }).from(sparringRequests).where(and(eq(sparringRequests.id, id), eq(sparringRequests.clubId, session.clubId))).for('update');
      if (!r) return false;
      if (r.status === 'arranged' && status === 'open') {
        // Only possible when the approved partner has since withdrawn.
        const [live] = await tx.select({ id: sparringOffers.id }).from(sparringOffers).where(and(eq(sparringOffers.requestId, id), eq(sparringOffers.status, 'approved')));
        if (live) throw new ApiError('conflict', 'A partner has been approved for this request.');
      }
      await tx.update(sparringRequests).set({ status }).where(eq(sparringRequests.id, id));
      if (status === 'closed') {
        // Closing ends any offers still waiting for an answer.
        await tx.update(sparringOffers).set({ status: 'declined', decidedAt: new Date() }).where(and(eq(sparringOffers.requestId, id), eq(sparringOffers.status, 'pending')));
      }
      await log(tx, session, status === 'closed' ? 'sparring.request_closed' : 'sparring.request_reopened', 'sparring_request', id, meta);
      return true;
    });
    if (!ok) throw new ApiError('not_found', 'Sparring request not found');
  } catch (err) {
    if (isUniqueViolation(err, 'sparring_requests_open_boxer_uq')) throw new ApiError('conflict', 'This boxer already has another open sparring request.');
    throw err;
  }
}

export const sparringOfferSchema = z.object({ boxerId: z.uuid({ error: 'Choose one of your boxers' }), note: text(500) });

export async function offerPartner(session: ClubSession, requestId: string, input: z.infer<typeof sparringOfferSchema>, meta: Meta): Promise<{ id: string }> {
  try {
    const res = await withClub(session.clubId, async (tx) => {
      await limit(tx, session);
      const [r] = await tx.select().from(sparringRequests).where(eq(sparringRequests.id, requestId));
      if (!r || r.clubId === session.clubId) return null;
      if (r.status !== 'open') throw new ApiError('conflict', 'This sparring request is no longer open.');
      await assertNotBlocked(tx, session.clubId, r.clubId);
      const cards = await boxerCards(tx, [r.boxerId, input.boxerId]);
      const theirs = cards.get(r.boxerId);
      const mine = cards.get(input.boxerId);
      if (!theirs || !theirs.clubApproved || theirs.archived) throw new ApiError('conflict', 'This sparring request is no longer available.');
      if (!mine || mine.clubId !== session.clubId || mine.archived) throw new ApiError('validation_failed', 'Check the highlighted fields', { boxerId: 'Choose one of your active boxers' });
      const blocked = gate(theirs, mine);
      if (blocked.length) throw new ApiError('validation_failed', 'Check the highlighted fields', { boxerId: `Not a suitable partner: ${blocked[0]!.toLowerCase()}` });
      const [o] = await tx
        .insert(sparringOffers)
        .values({ requestId, requestClubId: r.clubId, offeringClubId: session.clubId, partnerBoxerId: input.boxerId, note: input.note })
        .returning({ id: sparringOffers.id });
      await log(tx, session, 'sparring.partner_offered', 'sparring_offer', o!.id, meta);
      return o!;
    });
    if (!res) throw new ApiError('not_found', 'Sparring request not found');
    return res;
  } catch (err) {
    if (isUniqueViolation(err, 'sparring_offers_live_partner_uq')) throw new ApiError('conflict', 'You have already proposed this boxer for this request.');
    throw err;
  }
}

export async function decideOffer(session: ClubSession, offerId: string, action: 'approve' | 'decline' | 'withdraw', meta: Meta): Promise<{ status: string }> {
  const res = await withClub(session.clubId, async (tx) => {
    const [o] = await tx.select().from(sparringOffers).where(eq(sparringOffers.id, offerId)).for('update');
    if (!o) return null;
    const isRequester = o.requestClubId === session.clubId;
    const allowed = action === 'withdraw' ? !isRequester && (o.status === 'pending' || o.status === 'approved') : isRequester && o.status === 'pending';
    if (!allowed) throw new ApiError('conflict', 'That action is not available for this offer. Refresh to see its current status.');
    const [r] = await tx.select({ status: sparringRequests.status }).from(sparringRequests).where(eq(sparringRequests.id, o.requestId)).for('update');
    if (action === 'approve') {
      if (r?.status !== 'open') throw new ApiError('conflict', 'This sparring request is no longer open.');
      await tx.update(sparringOffers).set({ status: 'approved', decidedAt: new Date() }).where(eq(sparringOffers.id, offerId));
      // One boxer, one partner: other waiting offers are declined and the request is marked arranged.
      await tx.update(sparringOffers).set({ status: 'declined', decidedAt: new Date() }).where(and(eq(sparringOffers.requestId, o.requestId), eq(sparringOffers.status, 'pending')));
      await tx.update(sparringRequests).set({ status: 'arranged' }).where(eq(sparringRequests.id, o.requestId));
    } else if (action === 'decline') {
      await tx.update(sparringOffers).set({ status: 'declined', decidedAt: new Date() }).where(eq(sparringOffers.id, offerId));
    } else {
      await tx.update(sparringOffers).set({ status: 'withdrawn', decidedAt: new Date() }).where(eq(sparringOffers.id, offerId));
      // If this was the approved partner, the requesting club is shown that and can reopen the request.
    }
    await log(tx, session, `sparring.offer_${action}`, 'sparring_offer', offerId, meta);
    return { status: action === 'approve' ? 'approved' : action === 'decline' ? 'declined' : 'withdrawn' };
  });
  if (!res) throw new ApiError('not_found', 'Offer not found');
  return res;
}

export const attendanceSchema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && v <= ukToday(), 'Record attendance on or after the session date'),
  attended: z.boolean(),
  note: text(300),
});

/** Each club's attendance record is private to that club. */
export async function recordAttendance(session: ClubSession, offerId: string, input: z.infer<typeof attendanceSchema>, meta: Meta): Promise<void> {
  const ok = await withClub(session.clubId, async (tx) => {
    const [o] = await tx.select({ status: sparringOffers.status }).from(sparringOffers).where(eq(sparringOffers.id, offerId));
    if (!o) return false;
    if (o.status !== 'approved') throw new ApiError('conflict', 'Attendance can be recorded once a partner has been approved.');
    await tx
      .insert(sparringAttendance)
      .values({ offerId, clubId: session.clubId, ...input })
      .onConflictDoUpdate({ target: [sparringAttendance.offerId, sparringAttendance.clubId, sparringAttendance.sessionDate], set: { attended: input.attended, note: input.note } });
    await log(tx, session, 'sparring.attendance_recorded', 'sparring_offer', offerId, meta);
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Offer not found');
}

// Read ----------------------------------------------------------------------------

export type SparringSummary = { id: string; club: ClubName; mine: boolean; boxer: BoxerCard | null; availabilityNote: string | null; location: string | null; notes: string | null; status: 'open' | 'arranged' | 'closed'; createdAt: string; pendingOffers: number };

type ReqRow = typeof sparringRequests.$inferSelect;
async function summarise(tx: Tx, me: string, rows: ReqRow[]): Promise<SparringSummary[]> {
  const names = await clubNames(tx, rows.map((r) => r.clubId));
  const cards = await boxerCards(tx, rows.map((r) => r.boxerId));
  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await tx.select({ requestId: sparringOffers.requestId, n: sql<number>`count(*)::int` }).from(sparringOffers).where(and(inArray(sparringOffers.requestId, ids), eq(sparringOffers.status, 'pending'))).groupBy(sparringOffers.requestId)
    : [];
  const pending = new Map(counts.map((c) => [c.requestId, Number(c.n)]));
  return rows
    .map((r) => ({ r, club: names.get(r.clubId) }))
    .filter((x): x is { r: ReqRow; club: ClubName } => Boolean(x.club) && (x.club!.approved || x.r.clubId === me))
    .map(({ r, club }) => ({
      id: r.id, club, mine: r.clubId === me, boxer: cards.get(r.boxerId) ?? null, availabilityNote: r.availabilityNote, location: r.location, notes: r.notes,
      status: r.status, createdAt: r.createdAt.toISOString(), pendingOffers: pending.get(r.id) ?? 0,
    }));
}

export async function listSparring(session: ClubSession): Promise<{ open: SparringSummary[]; mine: SparringSummary[]; offered: SparringSummary[] }> {
  return withClub(session.clubId, async (tx) => {
    const me = session.clubId;
    const open = await tx.select().from(sparringRequests).where(and(eq(sparringRequests.status, 'open'), sql`${sparringRequests.clubId} <> ${me}::uuid`)).orderBy(desc(sparringRequests.createdAt)).limit(200);
    const mine = await tx.select().from(sparringRequests).where(eq(sparringRequests.clubId, me)).orderBy(desc(sparringRequests.createdAt)).limit(100);
    const offered = await tx
      .select()
      .from(sparringRequests)
      .where(sql`${sparringRequests.id} in (select o.request_id from sparring_offers o where o.offering_club_id = ${me}::uuid)`)
      .orderBy(desc(sparringRequests.updatedAt))
      .limit(100);
    return { open: await summarise(tx, me, open), mine: await summarise(tx, me, mine), offered: await summarise(tx, me, offered) };
  });
}

export type OfferView = { id: string; offeringClub: ClubName; partner: BoxerCard | null; note: string | null; status: 'pending' | 'approved' | 'declined' | 'withdrawn'; createdAt: string; byMe: boolean };
export type Suggestion = { boxer: BoxerCard; score: number; reasons: string[] };
export type AttendanceView = { sessionDate: string; attended: boolean; note: string | null };

export type SparringDetail = {
  request: SparringSummary;
  offers: OfferView[];
  /** For other clubs: their own boxers who pass the gates, most suitable first. */
  suggestions: Suggestion[];
  approvedOfferId: string | null;
  attendance: AttendanceView[];
};

export async function getSparring(session: ClubSession, id: string): Promise<SparringDetail | null> {
  return withClub(session.clubId, async (tx) => {
    const me = session.clubId;
    const [request] = await summarise(tx, me, await tx.select().from(sparringRequests).where(eq(sparringRequests.id, id)));
    if (!request) return null;
    // Row-level security returns all offers to the requester, and only its own to an offering club.
    const rows = await tx.select().from(sparringOffers).where(eq(sparringOffers.requestId, id)).orderBy(asc(sparringOffers.createdAt));
    const names = await clubNames(tx, rows.map((o) => o.offeringClubId));
    const cards = await boxerCards(tx, rows.map((o) => o.partnerBoxerId));
    const offers: OfferView[] = rows.map((o) => ({
      id: o.id, offeringClub: names.get(o.offeringClubId) ?? { id: o.offeringClubId, name: 'Club no longer listed', slug: '', isDemo: false, approved: false },
      partner: cards.get(o.partnerBoxerId) ?? null, note: o.note, status: o.status, createdAt: o.createdAt.toISOString(), byMe: o.offeringClubId === me,
    }));
    let suggestions: Suggestion[] = [];
    if (!request.mine && request.status === 'open' && request.boxer) {
      const target = request.boxer;
      const own = await tx.select({ id: boxers.id }).from(boxers).where(and(eq(boxers.clubId, me), isNull(boxers.archivedAt)));
      const ownCards = await boxerCards(tx, own.map((b) => b.id));
      const live = new Set(rows.filter((o) => o.status === 'pending' || o.status === 'approved').map((o) => o.partnerBoxerId));
      suggestions = [...ownCards.values()]
        .filter((b) => !live.has(b.id) && gate(target, b).length === 0 && Math.abs(b.weightKg - target.weightKg) <= SPAR_TOLERANCE_KG)
        .map((b) => {
          const s = score(target, b, { toleranceKg: SPAR_TOLERANCE_KG, ageGap: target.isJunior ? 2 : 10 });
          return { boxer: b, score: s.total, reasons: s.factors.slice(0, 3).map((f) => `${f.label}: ${f.detail}`) };
        })
        .sort((a, b) => b.score - a.score || a.boxer.id.localeCompare(b.boxer.id))
        .slice(0, 10);
    }
    const approved = rows.find((o) => o.status === 'approved');
    const attendance = approved
      ? (await tx.select({ sessionDate: sparringAttendance.sessionDate, attended: sparringAttendance.attended, note: sparringAttendance.note }).from(sparringAttendance).where(and(eq(sparringAttendance.offerId, approved.id), eq(sparringAttendance.clubId, me))).orderBy(desc(sparringAttendance.sessionDate)))
      : [];
    return { request, offers, suggestions, approvedOfferId: approved?.id ?? null, attendance };
  });
}
