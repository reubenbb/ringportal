import 'server-only';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAuth, withClub, type Tx } from '@/server/db/client';
import { boxers, opponentRequests, shows } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import type { ClubSession } from '@/server/auth/session';
import { boxerCards, clubNames, type BoxerCard, type ClubName } from '@/server/cross-club';
import { BOUT_TYPES, ukToday, type BoutType } from '@/lib/proposals';
import { londonToUtc } from '@/lib/shows';

type Meta = { ipHash: string };
const text = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer`).optional().nullable().transform((v) => v || null);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

async function limit(tx: Tx, session: ClubSession) {
  const r = await hit(tx, LIMITS.sensitiveAction, `listing:${session.clubId}`);
  if (!r.allowed) throw new ApiError('rate_limited', 'Too many changes. Please wait a few minutes.', undefined, r.retryAfterSeconds);
}

// Shows -------------------------------------------------------------------------

export const showSchema = z
  .object({
    name: z.string().trim().min(3, 'Enter the show name').max(120),
    date: z.string().refine(isDate, 'Enter a valid date').refine((v) => v >= ukToday(), 'The date cannot be in the past'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a start time'),
    venue: z.string().trim().min(2, 'Enter the venue').max(160),
    postcode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,5} ?[A-Z0-9]{0,4}$/, 'Enter a valid postcode'),
    contactRoute: text(300),
    requirements: text(1000),
    info: text(2000),
    listedPublicly: z.boolean().default(true),
  })
  .transform(({ date, time, ...rest }) => ({ ...rest, startsAt: londonToUtc(date, time) }));
export type ShowInput = z.infer<typeof showSchema>;

export type ShowView = {
  id: string; clubId: string; host: ClubName; mine: boolean; name: string; startsAt: string; venue: string; postcode: string;
  contactRoute: string | null; requirements: string | null; info: string | null; listedPublicly: boolean; status: 'scheduled' | 'cancelled';
};

type ShowRow = typeof shows.$inferSelect;
async function toShows(tx: Tx, me: string, rows: ShowRow[]): Promise<ShowView[]> {
  const names = await clubNames(tx, rows.map((r) => r.clubId));
  return rows
    .map((r) => ({ r, host: names.get(r.clubId) }))
    // Only shows hosted by clubs that are currently approved (or your own).
    .filter((x): x is { r: ShowRow; host: ClubName } => Boolean(x.host) && (x.host!.approved || x.r.clubId === me))
    .map(({ r, host }) => ({
      id: r.id, clubId: r.clubId, host, mine: r.clubId === me, name: r.name, startsAt: r.startsAt.toISOString(), venue: r.venue, postcode: r.postcode,
      contactRoute: r.contactRoute, requirements: r.requirements, info: r.info, listedPublicly: r.listedPublicly, status: r.status,
    }));
}

export async function createShow(session: ClubSession, input: ShowInput, meta: Meta): Promise<{ id: string }> {
  return withClub(session.clubId, async (tx) => {
    await limit(tx, session);
    const [s] = await tx.insert(shows).values({ clubId: session.clubId, ...input }).returning({ id: shows.id });
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'show.created', targetType: 'show', targetId: s!.id, ipHash: meta.ipHash });
    return s!;
  });
}

export async function updateShow(session: ClubSession, id: string, input: ShowInput, meta: Meta): Promise<void> {
  const ok = await withClub(session.clubId, async (tx) => {
    await limit(tx, session);
    const res = await tx.update(shows).set(input).where(and(eq(shows.id, id), eq(shows.clubId, session.clubId))).returning({ id: shows.id });
    if (!res.length) return false;
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'show.updated', targetType: 'show', targetId: id, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Show not found');
}

export async function setShowStatus(session: ClubSession, id: string, status: 'scheduled' | 'cancelled', meta: Meta): Promise<void> {
  const ok = await withClub(session.clubId, async (tx) => {
    const res = await tx.update(shows).set({ status }).where(and(eq(shows.id, id), eq(shows.clubId, session.clubId))).returning({ id: shows.id });
    if (!res.length) return false;
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: `show.${status}`, targetType: 'show', targetId: id, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Show not found');
}

export async function listShows(session: ClubSession, scope: 'upcoming' | 'mine'): Promise<ShowView[]> {
  return withClub(session.clubId, async (tx) => {
    const rows =
      scope === 'mine'
        ? await tx.select().from(shows).where(eq(shows.clubId, session.clubId)).orderBy(desc(shows.startsAt)).limit(100)
        : await tx.select().from(shows).where(and(eq(shows.status, 'scheduled'), gte(shows.startsAt, sql`now() - interval '12 hours'`))).orderBy(asc(shows.startsAt), asc(shows.id)).limit(200);
    return toShows(tx, session.clubId, rows);
  });
}

export async function getShow(session: ClubSession, id: string): Promise<{ show: ShowView; requests: RequestView[] } | null> {
  return withClub(session.clubId, async (tx) => {
    const [show] = await toShows(tx, session.clubId, await tx.select().from(shows).where(eq(shows.id, id)));
    if (!show) return null;
    const reqs = await tx.select().from(opponentRequests).where(and(eq(opponentRequests.showId, id), show.mine ? sql`true` : eq(opponentRequests.status, 'open'))).orderBy(asc(opponentRequests.weightKg));
    return { show, requests: await toRequests(tx, session.clubId, reqs) };
  });
}

export type PublicShow = { id: string; name: string; startsAt: string; hostClub: string; governingBody: string; venue: string; area: string };
/** Basic public calendar. No sign-in; contact details and requirements are never included. */
export async function publicCalendar(): Promise<PublicShow[]> {
  return withAuth(async (tx) => {
    const res = await tx.execute<{ id: string; name: string; starts_at: Date; host_club: string; governing_body: string; venue: string; area: string }>(sql`select * from public_show_calendar()`);
    return res.rows.map((r) => ({ id: r.id, name: r.name, startsAt: new Date(r.starts_at).toISOString(), hostClub: r.host_club, governingBody: r.governing_body, venue: r.venue, area: r.area }));
  });
}

// Opponent requests ---------------------------------------------------------------

const age = (label: string) => z.coerce.number({ error: `Enter ${label}` }).int('Whole years only').min(8, 'Ages 8 to 80').max(80, 'Ages 8 to 80');
const optionalId = z.string().optional().nullable().transform((v) => v || null).pipe(z.uuid().nullable());

export const requestSchema = z
  .object({
    showId: optionalId,
    boxerId: optionalId,
    sex: z.enum(['male', 'female'], { error: 'Choose a sex/category' }),
    minAge: age('a minimum age'),
    maxAge: age('a maximum age'),
    weightKg: z.coerce.number({ error: 'Enter a weight in kg' }).min(20, 'Weight must be between 20 and 200 kg').max(200, 'Weight must be between 20 and 200 kg').transform((v) => Math.round(v * 10) / 10),
    boutType: z.enum(BOUT_TYPES, { error: 'Choose competitive or skills' }),
    experience: text(200),
    neededOn: z.string().optional().nullable().transform((v) => v || null).refine((v) => v === null || isDate(v), 'Enter a valid date'),
    location: text(160),
    requirements: text(1000),
  })
  .refine((v) => v.minAge <= v.maxAge, { path: ['maxAge'], message: 'Maximum age must be at least the minimum age' })
  // Juniors never box adults, so a request is either for under-18s or for 18 and over, never both.
  .refine((v) => v.maxAge < v.minAge || v.minAge >= 18 || v.maxAge <= 17, {
    path: ['maxAge'],
    message: 'Under-18s cannot box adults: use an age range of 17 or under, or 18 and over',
  });
export type RequestInput = z.infer<typeof requestSchema>;

export type RequestView = {
  id: string; clubId: string; club: ClubName; mine: boolean; showId: string | null; showName: string | null; boxer: BoxerCard | null;
  sex: 'male' | 'female'; minAge: number; maxAge: number; weightKg: number; boutType: BoutType; experience: string | null; neededOn: string | null;
  location: string | null; requirements: string | null; status: 'open' | 'closed'; createdAt: string;
};

type RequestRow = typeof opponentRequests.$inferSelect;
async function toRequests(tx: Tx, me: string, rows: RequestRow[]): Promise<RequestView[]> {
  const names = await clubNames(tx, rows.map((r) => r.clubId));
  const cards = await boxerCards(tx, rows.filter((r) => r.boxerId).map((r) => r.boxerId!));
  const showIds = [...new Set(rows.filter((r) => r.showId).map((r) => r.showId!))];
  const showRows = showIds.length ? await tx.select({ id: shows.id, name: shows.name, status: shows.status }).from(shows).where(sql`${shows.id} = any(${sql.param(showIds)}::uuid[])`) : [];
  const showName = new Map(showRows.map((s) => [s.id, s.name]));
  return rows
    .map((r) => ({ r, club: names.get(r.clubId) }))
    .filter((x): x is { r: RequestRow; club: ClubName } => Boolean(x.club) && (x.club!.approved || x.r.clubId === me))
    .map(({ r, club }) => {
      const card = r.boxerId ? cards.get(r.boxerId) : undefined;
      return {
        id: r.id, clubId: r.clubId, club, mine: r.clubId === me, showId: r.showId, showName: r.showId ? (showName.get(r.showId) ?? null) : null,
        boxer: card && !card.archived ? card : null,
        sex: r.sex, minAge: r.minAge, maxAge: r.maxAge, weightKg: Number(r.weightKg), boutType: r.boutType, experience: r.experience, neededOn: r.neededOn,
        location: r.location, requirements: r.requirements, status: r.status, createdAt: r.createdAt.toISOString(),
      };
    });
}

/** The show and boxer a request links to must belong to the requesting club. */
async function checkLinks(tx: Tx, session: ClubSession, input: RequestInput) {
  if (input.showId) {
    const [s] = await tx.select({ id: shows.id }).from(shows).where(and(eq(shows.id, input.showId), eq(shows.clubId, session.clubId)));
    if (!s) throw new ApiError('validation_failed', 'Check the highlighted fields', { showId: 'Choose one of your own shows' });
  }
  if (input.boxerId) {
    const [b] = await tx.select({ sex: boxers.sex }).from(boxers).where(and(eq(boxers.id, input.boxerId), eq(boxers.clubId, session.clubId), isNull(boxers.archivedAt)));
    if (!b) throw new ApiError('validation_failed', 'Check the highlighted fields', { boxerId: 'Choose one of your active boxers' });
    if (b.sex !== input.sex) throw new ApiError('validation_failed', 'Check the highlighted fields', { sex: 'This must match your boxer’s sex category' });
    const card = (await boxerCards(tx, [input.boxerId])).get(input.boxerId);
    if (!card) throw new ApiError('validation_failed', 'Check the highlighted fields', { boxerId: 'Choose one of your active boxers' });
    const rangeIsJunior = input.maxAge <= 17;
    if (card.isJunior !== rangeIsJunior) {
      throw new ApiError('validation_failed', 'Check the highlighted fields', {
        maxAge: card.isJunior ? 'Your boxer is under 18, so opponents must be 17 or under' : 'Your boxer is 18 or over, so opponents must be 18 or over',
      });
    }
  }
}

export async function createRequest(session: ClubSession, input: RequestInput, meta: Meta): Promise<{ id: string }> {
  return withClub(session.clubId, async (tx) => {
    await limit(tx, session);
    await checkLinks(tx, session, input);
    const [r] = await tx.insert(opponentRequests).values({ clubId: session.clubId, ...input }).returning({ id: opponentRequests.id });
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'opponent_request.created', targetType: 'opponent_request', targetId: r!.id, ipHash: meta.ipHash });
    return r!;
  });
}

export async function updateRequest(session: ClubSession, id: string, input: RequestInput, meta: Meta): Promise<void> {
  const ok = await withClub(session.clubId, async (tx) => {
    await limit(tx, session);
    await checkLinks(tx, session, input);
    const res = await tx.update(opponentRequests).set(input).where(and(eq(opponentRequests.id, id), eq(opponentRequests.clubId, session.clubId))).returning({ id: opponentRequests.id });
    if (!res.length) return false;
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'opponent_request.updated', targetType: 'opponent_request', targetId: id, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Request not found');
}

export async function setRequestStatus(session: ClubSession, id: string, status: 'open' | 'closed', meta: Meta): Promise<void> {
  const ok = await withClub(session.clubId, async (tx) => {
    const res = await tx
      .update(opponentRequests)
      .set({ status, closedAt: status === 'closed' ? new Date() : null })
      .where(and(eq(opponentRequests.id, id), eq(opponentRequests.clubId, session.clubId)))
      .returning({ id: opponentRequests.id });
    if (!res.length) return false;
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: status === 'closed' ? 'opponent_request.closed' : 'opponent_request.reopened', targetType: 'opponent_request', targetId: id, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Request not found');
}

export async function listRequests(session: ClubSession, scope: 'open' | 'mine'): Promise<RequestView[]> {
  return withClub(session.clubId, async (tx) => {
    const rows = await tx
      .select()
      .from(opponentRequests)
      .where(scope === 'mine' ? eq(opponentRequests.clubId, session.clubId) : and(eq(opponentRequests.status, 'open'), sql`${opponentRequests.clubId} <> ${session.clubId}::uuid`))
      .orderBy(desc(opponentRequests.createdAt))
      .limit(200);
    return toRequests(tx, session.clubId, rows);
  });
}

export async function getOwnRequest(session: ClubSession, id: string): Promise<RequestView | null> {
  return withClub(session.clubId, async (tx) => {
    const rows = await tx.select().from(opponentRequests).where(and(eq(opponentRequests.id, id), eq(opponentRequests.clubId, session.clubId)));
    return (await toRequests(tx, session.clubId, rows))[0] ?? null;
  });
}

export async function listOwnShowOptions(session: ClubSession): Promise<{ id: string; name: string; startsAt: string }[]> {
  return withClub(session.clubId, async (tx) => {
    const rows = await tx.select({ id: shows.id, name: shows.name, startsAt: shows.startsAt }).from(shows).where(and(eq(shows.clubId, session.clubId), eq(shows.status, 'scheduled'), gte(shows.startsAt, sql`now() - interval '1 day'`))).orderBy(asc(shows.startsAt));
    return rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString() }));
  });
}
