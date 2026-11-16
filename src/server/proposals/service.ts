import 'server-only';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withClub, type Tx } from '@/server/db/client';
import {
  boutProposalConfirmations,
  boutProposalEvents,
  boutProposalVersions,
  boutProposals,
  boxers,
  conversationClubState,
  conversations,
  messages,
} from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import type { ClubSession } from '@/server/auth/session';
import { boxerCards, clubNames, isUniqueViolation, type BoxerCard, type ClubName } from '@/server/cross-club';
import { MESSAGE_MAX } from '@/lib/messaging';
import {
  BOUT_TYPES,
  OPEN_STATUSES,
  availableActions,
  changedTerms,
  needsAction,
  ukToday,
  waitingOn,
  type LifecycleState,
  type ProposalAction,
  type ProposalStatus,
  type Terms,
} from '@/lib/proposals';

type Meta = { ipHash: string };

const UNAVAILABLE = new Set(['injured_medical', 'inactive']);

// Input -----------------------------------------------------------------------

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .optional()
    .nullable()
    .transform((v) => v || null);

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const termsSchema = z.object({
  proposedDate: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))), 'Enter a valid date')
    .refine((v) => v === null || v >= ukToday(), 'The date cannot be in the past')
    .refine((v) => v === null || v <= addDays(ukToday(), 730), 'Choose a date within the next two years'),
  weightKg: z.coerce
    .number({ error: 'Enter a weight in kg' })
    .min(20, 'Weight must be between 20 and 200 kg')
    .max(200, 'Weight must be between 20 and 200 kg')
    .transform((v) => Math.round(v * 10) / 10),
  boutType: z.enum(BOUT_TYPES, { error: 'Choose competitive or skills' }),
  travel: optionalText(500, 'Travel'),
  terms: optionalText(1000, 'Other terms'),
});

const messageField = optionalText(MESSAGE_MAX, 'Message');

export const createProposalSchema = termsSchema.extend({
  proposingBoxerId: z.uuid({ error: 'Choose one of your boxers' }),
  receivingBoxerId: z.uuid({ error: 'Choose the opponent' }),
  message: messageField,
});
export type CreateProposalInput = z.infer<typeof createProposalSchema>;

const expectedVersion = z.coerce.number().int().min(1);

export const proposalActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), expectedVersion }),
  z.object({ action: z.literal('confirm'), expectedVersion }),
  z.object({ action: z.literal('decline'), expectedVersion, message: messageField }),
  z.object({ action: z.literal('withdraw'), expectedVersion: expectedVersion.optional(), message: messageField }),
  z.object({ action: z.literal('revise'), expectedVersion, terms: termsSchema, message: messageField }),
]);
export type ProposalActionInput = z.infer<typeof proposalActionSchema>;

// Helpers ---------------------------------------------------------------------

function pair(a: string, b: string): [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

async function rateLimit(tx: Tx, session: ClubSession) {
  const r = await hit(tx, LIMITS.proposalAction, `club:${session.clubId}`);
  if (!r.allowed) throw new ApiError('rate_limited', 'Too many proposal actions. Please wait a few minutes and try again.', undefined, r.retryAfterSeconds);
}

async function postMessage(tx: Tx, session: ClubSession, conversationId: string, body: string) {
  const [m] = await tx
    .insert(messages)
    .values({ conversationId, senderClubId: session.clubId, senderUserId: session.clubUserId, body })
    .returning({ id: messages.id, createdAt: messages.createdAt });
  await tx.update(conversations).set({ lastMessageAt: m!.createdAt }).where(eq(conversations.id, conversationId));
  // Sending implies you have read the thread up to your own message.
  await tx
    .insert(conversationClubState)
    .values({ conversationId, clubId: session.clubId, lastReadMessageId: m!.id })
    .onConflictDoUpdate({
      target: [conversationClubState.conversationId, conversationClubState.clubId],
      set: { lastReadMessageId: sql`greatest(${conversationClubState.lastReadMessageId}, ${m!.id})`, archivedAt: null },
    });
  return m!;
}

function termsOf(v: { proposedDate: string | null; weightKg: number | string; boutType: Terms['boutType']; travel: string | null; terms: string | null }): Terms {
  return { proposedDate: v.proposedDate, weightKg: Number(v.weightKg), boutType: v.boutType, travel: v.travel, terms: v.terms };
}

// Create ------------------------------------------------------------------------

export async function createProposal(session: ClubSession, input: CreateProposalInput, meta: Meta): Promise<{ id: string }> {
  return withClub(session.clubId, async (tx) => {
    await rateLimit(tx, session);

    const [own] = await tx
      .select({ id: boxers.id, sex: boxers.sex, availability: boxers.availability })
      .from(boxers)
      .where(and(eq(boxers.id, input.proposingBoxerId), eq(boxers.clubId, session.clubId), isNull(boxers.archivedAt)));
    if (!own) throw new ApiError('validation_failed', 'Check the highlighted fields', { proposingBoxerId: 'Choose one of your active boxers' });
    if (UNAVAILABLE.has(own.availability)) {
      throw new ApiError('validation_failed', 'Check the highlighted fields', { proposingBoxerId: 'This boxer is marked injured/medical or inactive. Update their availability first.' });
    }

    const opponent = (await boxerCards(tx, [input.receivingBoxerId])).get(input.receivingBoxerId);
    if (!opponent || opponent.clubId === session.clubId || !opponent.clubApproved || opponent.archived) {
      throw new ApiError('validation_failed', 'Check the highlighted fields', { receivingBoxerId: 'This boxer is not available for proposals' });
    }
    if (UNAVAILABLE.has(opponent.availability)) {
      throw new ApiError('validation_failed', 'Check the highlighted fields', { receivingBoxerId: 'This boxer is currently marked injured/medical or inactive by their club' });
    }
    if (opponent.sex !== own.sex) {
      throw new ApiError('validation_failed', 'Check the highlighted fields', { proposingBoxerId: 'Both boxers must be in the same sex category' });
    }

    const [existing] = await tx
      .select({ id: boutProposals.id })
      .from(boutProposals)
      .where(
        and(
          inArray(boutProposals.status, [...OPEN_STATUSES]),
          sql`least(${boutProposals.proposingBoxerId}, ${boutProposals.receivingBoxerId}) = least(${own.id}::uuid, ${opponent.id}::uuid)`,
          sql`greatest(${boutProposals.proposingBoxerId}, ${boutProposals.receivingBoxerId}) = greatest(${own.id}::uuid, ${opponent.id}::uuid)`,
        ),
      );
    if (existing) throw new ApiError('conflict', 'There is already an open proposal between these two boxers. Open it from Bout proposals to continue the negotiation.');

    let proposalId: string;
    try {
      const [p] = await tx
        .insert(boutProposals)
        .values({
          proposingClubId: session.clubId,
          receivingClubId: opponent.clubId,
          proposingBoxerId: own.id,
          receivingBoxerId: opponent.id,
          status: 'sent',
          currentVersion: 1,
        })
        .returning({ id: boutProposals.id });
      proposalId = p!.id;
    } catch (err) {
      if (isUniqueViolation(err, 'bout_proposals_open_pair_uq')) {
        throw new ApiError('conflict', 'There is already an open proposal between these two boxers. Open it from Bout proposals to continue the negotiation.');
      }
      throw err;
    }

    await tx.insert(boutProposalVersions).values({
      proposalId,
      version: 1,
      authorClubId: session.clubId,
      proposedDate: input.proposedDate,
      weightKg: input.weightKg,
      boutType: input.boutType,
      travel: input.travel,
      terms: input.terms,
    });
    await tx.insert(boutProposalEvents).values({ proposalId, version: 1, clubId: session.clubId, actorId: session.clubUserId, event: 'created', fromStatus: null, toStatus: 'sent' });

    const [low, high] = pair(session.clubId, opponent.clubId);
    const [conv] = await tx
      .insert(conversations)
      .values({ clubLowId: low, clubHighId: high, kind: 'proposal', proposalId, startedByClubId: session.clubId })
      .returning({ id: conversations.id });
    if (input.message) await postMessage(tx, session, conv!.id, input.message);

    await audit(tx, {
      actorType: 'club_user',
      actorId: session.clubUserId,
      clubId: session.clubId,
      action: 'proposal.created',
      targetType: 'bout_proposal',
      targetId: proposalId,
      metadata: { version: 1, receivingClubId: opponent.clubId },
      ipHash: meta.ipHash,
    });
    return { id: proposalId };
  });
}

// Actions -----------------------------------------------------------------------

const STALE = 'This proposal has changed since you opened it. Refresh to see the latest terms before acting.';

export async function actOnProposal(session: ClubSession, id: string, input: ProposalActionInput, meta: Meta): Promise<{ status: ProposalStatus; version: number }> {
  const result = await withClub(session.clubId, async (tx) => {
    await rateLimit(tx, session);
    // Row lock: concurrent actions on one proposal are serialised.
    const [p] = await tx.select().from(boutProposals).where(eq(boutProposals.id, id)).for('update');
    if (!p) return null;

    if (input.expectedVersion !== undefined && input.expectedVersion !== p.currentVersion) throw new ApiError('conflict', STALE);

    const [current] = await tx
      .select()
      .from(boutProposalVersions)
      .where(and(eq(boutProposalVersions.proposalId, id), eq(boutProposalVersions.version, p.currentVersion)));
    if (!current) throw new Error('proposal has no current version');
    const confirmed = await tx
      .select({ clubId: boutProposalConfirmations.clubId })
      .from(boutProposalConfirmations)
      .where(and(eq(boutProposalConfirmations.proposalId, id), eq(boutProposalConfirmations.version, p.currentVersion)));

    const state: LifecycleState = {
      status: p.status,
      proposingClubId: p.proposingClubId,
      receivingClubId: p.receivingClubId,
      currentAuthorClubId: current.authorClubId,
      confirmedClubIds: confirmed.map((c) => c.clubId),
    };
    if (!availableActions(state, session.clubId).includes(input.action)) {
      throw new ApiError('conflict', 'That action is not available for this proposal right now. Refresh to see its current status.');
    }

    let next: ProposalStatus = p.status;
    let version = p.currentVersion;
    const events: Array<{ event: 'revised' | 'accepted' | 'confirmed' | 'bout_confirmed' | 'declined' | 'withdrawn'; to: ProposalStatus }> = [];

    switch (input.action) {
      case 'accept':
        next = 'accepted_in_principle';
        events.push({ event: 'accepted', to: next });
        break;
      case 'confirm': {
        await tx.insert(boutProposalConfirmations).values({ proposalId: id, version, clubId: session.clubId, confirmedBy: session.clubUserId });
        const both = new Set([...state.confirmedClubIds, session.clubId]);
        next = both.has(p.proposingClubId) && both.has(p.receivingClubId) ? 'confirmed' : 'awaiting_confirmation';
        events.push({ event: 'confirmed', to: next });
        if (next === 'confirmed') events.push({ event: 'bout_confirmed', to: next });
        break;
      }
      case 'decline':
        next = 'declined';
        events.push({ event: 'declined', to: next });
        break;
      case 'withdraw':
        next = 'withdrawn';
        events.push({ event: 'withdrawn', to: next });
        break;
      case 'revise': {
        const changed = changedTerms(termsOf(current), input.terms);
        if (!changed.length) {
          throw new ApiError('validation_failed', 'Change at least one term to propose a revision', { _: 'Nothing has changed from the current terms' });
        }
        version = p.currentVersion + 1;
        await tx.insert(boutProposalVersions).values({
          proposalId: id,
          version,
          authorClubId: session.clubId,
          proposedDate: input.terms.proposedDate,
          weightKg: input.terms.weightKg,
          boutType: input.terms.boutType,
          travel: input.terms.travel,
          terms: input.terms.terms,
        });
        // A new version resets acceptance and both final confirmations (they belong to the previous version).
        next = 'negotiating';
        events.push({ event: 'revised', to: next });
        break;
      }
    }

    const statusChanged = next !== p.status;
    await tx
      .update(boutProposals)
      .set({ status: next, currentVersion: version, ...(statusChanged ? { statusChangedAt: new Date() } : {}) })
      .where(eq(boutProposals.id, id));

    // Keep both boxers' availability in step with a confirmed (or un-confirmed) bout.
    if (p.status === 'confirmed' || next === 'confirmed') await tx.execute(sql`select sync_bout_availability(${id}::uuid)`);

    let from: ProposalStatus | null = p.status;
    for (const e of events) {
      await tx.insert(boutProposalEvents).values({ proposalId: id, version, clubId: session.clubId, actorId: session.clubUserId, event: e.event, fromStatus: from, toStatus: e.to });
      from = e.to;
    }

    const message = 'message' in input ? input.message : null;
    if (message) {
      const [conv] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.proposalId, id));
      if (conv) await postMessage(tx, session, conv.id, message);
    }

    await audit(tx, {
      actorType: 'club_user',
      actorId: session.clubUserId,
      clubId: session.clubId,
      action: `proposal.${input.action}`,
      targetType: 'bout_proposal',
      targetId: id,
      metadata: { version, from: p.status, to: next },
      ipHash: meta.ipHash,
    });
    return { status: next, version };
  });
  if (!result) throw new ApiError('not_found', 'Proposal not found');
  return result;
}

// Read --------------------------------------------------------------------------

export type ProposalVersionView = Terms & {
  version: number;
  authorClubId: string;
  createdAt: string;
  changed: (keyof Terms)[];
};

export type ProposalDetail = {
  id: string;
  status: ProposalStatus;
  statusChangedAt: string;
  createdAt: string;
  currentVersion: number;
  viewerClubId: string;
  proposingClub: ClubName;
  receivingClub: ClubName;
  proposingBoxer: BoxerCard | null;
  receivingBoxer: BoxerCard | null;
  current: ProposalVersionView;
  versions: ProposalVersionView[];
  confirmations: { clubId: string; confirmedAt: string }[];
  events: { id: number; version: number; clubId: string; event: string; fromStatus: ProposalStatus | null; toStatus: ProposalStatus; occurredAt: string }[];
  waitingOn: string[];
  actions: ProposalAction[];
  conversationId: string | null;
};

const unknownClub = (id: string): ClubName => ({ id, name: 'Club no longer listed', slug: '', isDemo: false, approved: false });

export async function getProposal(session: ClubSession, id: string): Promise<ProposalDetail | null> {
  return withClub(session.clubId, async (tx) => {
    const [p] = await tx.select().from(boutProposals).where(eq(boutProposals.id, id));
    if (!p) return null;
    const versionRows = await tx.select().from(boutProposalVersions).where(eq(boutProposalVersions.proposalId, id)).orderBy(asc(boutProposalVersions.version));
    const versions: ProposalVersionView[] = versionRows.map((v, i) => {
      const terms = termsOf(v);
      return {
        ...terms,
        version: v.version,
        authorClubId: v.authorClubId,
        createdAt: v.createdAt.toISOString(),
        changed: i === 0 ? [] : changedTerms(termsOf(versionRows[i - 1]!), terms),
      };
    });
    const current = versions.find((v) => v.version === p.currentVersion)!;
    const confirmations = (
      await tx
        .select({ clubId: boutProposalConfirmations.clubId, confirmedAt: boutProposalConfirmations.confirmedAt })
        .from(boutProposalConfirmations)
        .where(and(eq(boutProposalConfirmations.proposalId, id), eq(boutProposalConfirmations.version, p.currentVersion)))
    ).map((c) => ({ clubId: c.clubId, confirmedAt: c.confirmedAt.toISOString() }));
    const events = (
      await tx
        .select({
          id: boutProposalEvents.id,
          version: boutProposalEvents.version,
          clubId: boutProposalEvents.clubId,
          event: boutProposalEvents.event,
          fromStatus: boutProposalEvents.fromStatus,
          toStatus: boutProposalEvents.toStatus,
          occurredAt: boutProposalEvents.occurredAt,
        })
        .from(boutProposalEvents)
        .where(eq(boutProposalEvents.proposalId, id))
        .orderBy(asc(boutProposalEvents.id))
    ).map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() }));
    const [conv] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.proposalId, id));
    const names = await clubNames(tx, [p.proposingClubId, p.receivingClubId]);
    const cards = await boxerCards(tx, [p.proposingBoxerId, p.receivingBoxerId]);

    const state: LifecycleState = {
      status: p.status,
      proposingClubId: p.proposingClubId,
      receivingClubId: p.receivingClubId,
      currentAuthorClubId: current.authorClubId,
      confirmedClubIds: confirmations.map((c) => c.clubId),
    };
    return {
      id: p.id,
      status: p.status,
      statusChangedAt: p.statusChangedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      currentVersion: p.currentVersion,
      viewerClubId: session.clubId,
      proposingClub: names.get(p.proposingClubId) ?? unknownClub(p.proposingClubId),
      receivingClub: names.get(p.receivingClubId) ?? unknownClub(p.receivingClubId),
      proposingBoxer: cards.get(p.proposingBoxerId) ?? null,
      receivingBoxer: cards.get(p.receivingBoxerId) ?? null,
      current,
      versions,
      confirmations,
      events,
      waitingOn: waitingOn(state),
      actions: availableActions(state, session.clubId),
      conversationId: conv?.id ?? null,
    };
  });
}

export type ProposalFilter = 'action' | 'open' | 'confirmed' | 'closed';
export const PROPOSAL_FILTERS: readonly ProposalFilter[] = ['action', 'open', 'confirmed', 'closed'];

export type ProposalListItem = {
  id: string;
  status: ProposalStatus;
  updatedAt: string;
  currentVersion: number;
  needsMyAction: boolean;
  iProposed: boolean;
  otherClub: ClubName;
  myBoxer: BoxerCard | null;
  theirBoxer: BoxerCard | null;
  terms: Terms;
};

const PAGE = 25;

type ListRow = {
  id: string;
  status: ProposalStatus;
  updated_at: Date;
  cursor_at: string;
  current_version: number;
  proposing_club_id: string;
  receiving_club_id: string;
  proposing_boxer_id: string;
  receiving_boxer_id: string;
  author_club_id: string;
  proposed_date: string | null;
  weight_kg: string;
  bout_type: Terms['boutType'];
  travel: string | null;
  terms: string | null;
  confirmed_by_me: boolean;
  confirmed_ids: string[] | null;
};

/** Cursor is "<updated_at as Postgres text, full precision>|<id>" of the last row of the previous page. */
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseCursor(cursor: string | undefined | null): { at: string; id: string } | null {
  if (!cursor || cursor.length > 80) return null;
  const [at, cid] = cursor.split('|');
  if (!at || !cid || !CURSOR_TS.test(at) || !CURSOR_ID.test(cid)) return null;
  return { at, id: cid };
}

export async function listProposals(
  session: ClubSession,
  filter: ProposalFilter,
  cursor?: string | null,
): Promise<{ items: ProposalListItem[]; nextCursor: string | null }> {
  return withClub(session.clubId, async (tx) => {
    const me = session.clubId;
    const after = parseCursor(cursor);
    const needs = sql`(
      (p.status in ('sent', 'negotiating') and v.author_club_id <> ${me}::uuid)
      or (p.status in ('accepted_in_principle', 'awaiting_confirmation') and not exists (
            select 1 from bout_proposal_confirmations c
            where c.proposal_id = p.id and c.version = p.current_version and c.club_id = ${me}::uuid)))`;
    const where =
      filter === 'action'
        ? needs
        : filter === 'open'
          ? sql`p.status in ('sent', 'negotiating', 'accepted_in_principle', 'awaiting_confirmation')`
          : filter === 'confirmed'
            ? sql`p.status = 'confirmed'`
            : sql`p.status in ('declined', 'withdrawn')`;
    const res = await tx.execute<ListRow>(sql`
      select p.id, p.status, p.updated_at, p.updated_at::text as cursor_at, p.current_version, p.proposing_club_id, p.receiving_club_id,
             p.proposing_boxer_id, p.receiving_boxer_id, v.author_club_id, v.proposed_date::text as proposed_date,
             v.weight_kg, v.bout_type, v.travel, v.terms,
             exists (select 1 from bout_proposal_confirmations c where c.proposal_id = p.id and c.version = p.current_version and c.club_id = ${me}::uuid) as confirmed_by_me,
             (select array_agg(c.club_id::text) from bout_proposal_confirmations c where c.proposal_id = p.id and c.version = p.current_version) as confirmed_ids
      from bout_proposals p
      join bout_proposal_versions v on v.proposal_id = p.id and v.version = p.current_version
      where (p.proposing_club_id = ${me}::uuid or p.receiving_club_id = ${me}::uuid)
        and ${where}
        ${after ? sql`and (p.updated_at, p.id) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql``}
      order by p.updated_at desc, p.id desc
      limit ${PAGE + 1}`);
    const rows = res.rows.slice(0, PAGE);
    const otherIds = rows.map((r) => (r.proposing_club_id === me ? r.receiving_club_id : r.proposing_club_id));
    const names = await clubNames(tx, otherIds);
    const cards = await boxerCards(tx, rows.flatMap((r) => [r.proposing_boxer_id, r.receiving_boxer_id]));
    const items = rows.map((r): ProposalListItem => {
      const iProposed = r.proposing_club_id === me;
      const other = iProposed ? r.receiving_club_id : r.proposing_club_id;
      const state: LifecycleState = {
        status: r.status,
        proposingClubId: r.proposing_club_id,
        receivingClubId: r.receiving_club_id,
        currentAuthorClubId: r.author_club_id,
        confirmedClubIds: r.confirmed_ids ?? [],
      };
      return {
        id: r.id,
        status: r.status,
        updatedAt: new Date(r.updated_at).toISOString(),
        currentVersion: Number(r.current_version),
        needsMyAction: needsAction(state, me),
        iProposed,
        otherClub: names.get(other) ?? unknownClub(other),
        myBoxer: cards.get(iProposed ? r.proposing_boxer_id : r.receiving_boxer_id) ?? null,
        theirBoxer: cards.get(iProposed ? r.receiving_boxer_id : r.proposing_boxer_id) ?? null,
        terms: { proposedDate: r.proposed_date, weightKg: Number(r.weight_kg), boutType: r.bout_type, travel: r.travel, terms: r.terms },
      };
    });
    const last = rows[rows.length - 1];
    return { items, nextCursor: res.rows.length > PAGE && last ? `${last.cursor_at}|${last.id}` : null };
  });
}

/** Proposals where the viewer's club must act next. */
export async function countProposalsNeedingAction(tx: Tx, clubId: string): Promise<number> {
  const res = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n
    from bout_proposals p
    join bout_proposal_versions v on v.proposal_id = p.id and v.version = p.current_version
    where (p.proposing_club_id = ${clubId}::uuid or p.receiving_club_id = ${clubId}::uuid)
      and ((p.status in ('sent', 'negotiating') and v.author_club_id <> ${clubId}::uuid)
        or (p.status in ('accepted_in_principle', 'awaiting_confirmation') and not exists (
              select 1 from bout_proposal_confirmations c
              where c.proposal_id = p.id and c.version = p.current_version and c.club_id = ${clubId}::uuid)))`);
  return Number(res.rows[0]?.n ?? 0);
}

/** Own active boxers, for the "your boxer" picker on a new proposal. */
export async function ownBoxersForProposal(session: ClubSession): Promise<BoxerCard[]> {
  return withClub(session.clubId, async (tx) => {
    const own = await tx
      .select({ id: boxers.id })
      .from(boxers)
      .where(and(eq(boxers.clubId, session.clubId), isNull(boxers.archivedAt)))
      .orderBy(asc(boxers.lastName), asc(boxers.firstName));
    const cards = await boxerCards(tx, own.map((b) => b.id));
    return own.map((b) => cards.get(b.id)).filter((c): c is BoxerCard => Boolean(c));
  });
}

/** An opponent card for the new-proposal screen, if this club may propose against them. */
export async function opponentForProposal(session: ClubSession, boxerId: string): Promise<{ boxer: BoxerCard; club: ClubName } | null> {
  return withClub(session.clubId, async (tx) => {
    const card = (await boxerCards(tx, [boxerId])).get(boxerId);
    if (!card || card.clubId === session.clubId || !card.clubApproved || card.archived) return null;
    const club = (await clubNames(tx, [card.clubId])).get(card.clubId);
    return club ? { boxer: card, club } : null;
  });
}

