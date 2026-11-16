import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withClub, type Tx } from '@/server/db/client';
import { boutProposals, conversationClubState, conversations, messages } from '@/server/db/schema';
import { ApiError } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import type { ClubSession } from '@/server/auth/session';
import { boxerCards, clubNames, type BoxerCard, type ClubName } from '@/server/cross-club';
import { countProposalsNeedingAction } from '@/server/proposals/service';
import { MESSAGE_MAX, type ConversationKind } from '@/lib/messaging';

// Input -----------------------------------------------------------------------

export const openConversationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('general'), clubId: z.uuid() }),
  z.object({ kind: z.literal('boxer'), boxerId: z.uuid() }),
]);
export type OpenConversationInput = z.infer<typeof openConversationSchema>;

export const messageBodySchema = z.object({
  body: z
    .string()
    .transform((v) => v.replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().min(1, 'Write a message').max(MESSAGE_MAX, `Messages must be ${MESSAGE_MAX} characters or fewer`)),
});

function pair(a: string, b: string): [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

const otherOf = (c: { clubLowId: string; clubHighId: string }, me: string) => (c.clubLowId === me ? c.clubHighId : c.clubLowId);

// Open (find or create) -----------------------------------------------------------

export async function openConversation(session: ClubSession, input: OpenConversationInput): Promise<{ id: string }> {
  return withClub(session.clubId, async (tx) => {
    const r = await hit(tx, LIMITS.conversationOpen, `club:${session.clubId}`);
    if (!r.allowed) throw new ApiError('rate_limited', 'Too many new conversations. Please wait a few minutes.', undefined, r.retryAfterSeconds);

    let otherClubId: string;
    let boxerId: string | null = null;
    if (input.kind === 'general') {
      const club = (await clubNames(tx, [input.clubId])).get(input.clubId);
      if (!club || !club.approved || club.id === session.clubId) throw new ApiError('not_found', 'Club not found');
      otherClubId = club.id;
    } else {
      const card = (await boxerCards(tx, [input.boxerId])).get(input.boxerId);
      if (!card || card.clubId === session.clubId || !card.clubApproved || card.archived) throw new ApiError('not_found', 'Boxer not found');
      otherClubId = card.clubId;
      boxerId = card.id;
    }

    const [low, high] = pair(session.clubId, otherClubId);
    const find = () =>
      tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.clubLowId, low),
            eq(conversations.clubHighId, high),
            eq(conversations.kind, input.kind),
            boxerId ? eq(conversations.boxerId, boxerId) : sql`true`,
          ),
        );
    const [existing] = await find();
    if (existing) return existing;
    // Partial unique indexes make this idempotent under concurrent double-clicks.
    await tx.insert(conversations).values({ clubLowId: low, clubHighId: high, kind: input.kind, boxerId, startedByClubId: session.clubId }).onConflictDoNothing();
    const [created] = await find();
    if (!created) throw new Error('conversation not created');
    return created;
  });
}

// Read models ---------------------------------------------------------------------

export type ConversationSummary = {
  id: string;
  kind: ConversationKind;
  otherClub: ClubName;
  title: string;
  boxer: BoxerCard | null;
  proposalId: string | null;
  lastMessageAt: string | null;
  lastMessage: { body: string; fromMe: boolean } | null;
  unread: number;
  archived: boolean;
};

export type MessageView = { id: number; body: string; fromMe: boolean; createdAt: string };

const unknownClub = (id: string): ClubName => ({ id, name: 'Club no longer listed', slug: '', isDemo: false, approved: false });

type ConvRow = {
  id: string;
  kind: ConversationKind;
  club_low_id: string;
  club_high_id: string;
  boxer_id: string | null;
  proposal_id: string | null;
  last_message_at: Date | null;
  cursor_at: string | null;
  archived_at: Date | null;
  unread: number;
  last_body: string | null;
  last_sender: string | null;
};

async function describe(tx: Tx, me: string, rows: ConvRow[]): Promise<ConversationSummary[]> {
  const others = rows.map((r) => (r.club_low_id === me ? r.club_high_id : r.club_low_id));
  const names = await clubNames(tx, others);
  const proposalIds = rows.filter((r) => r.proposal_id).map((r) => r.proposal_id!);
  const proposals = proposalIds.length
    ? await tx
        .select({ id: boutProposals.id, a: boutProposals.proposingBoxerId, b: boutProposals.receivingBoxerId })
        .from(boutProposals)
        .where(sql`${boutProposals.id} = any(${sql.param(proposalIds)}::uuid[])`)
    : [];
  const byProposal = new Map(proposals.map((p) => [p.id, p]));
  const cards = await boxerCards(tx, [...rows.filter((r) => r.boxer_id).map((r) => r.boxer_id!), ...proposals.flatMap((p) => [p.a, p.b])]);

  return rows.map((r, i) => {
    const otherClub = names.get(others[i]!) ?? unknownClub(others[i]!);
    const boxer = r.boxer_id ? (cards.get(r.boxer_id) ?? null) : null;
    let title = `General: ${otherClub.name}`;
    if (r.kind === 'boxer') title = `About ${boxer?.displayName ?? 'a boxer'}`;
    if (r.kind === 'proposal') {
      const p = r.proposal_id ? byProposal.get(r.proposal_id) : undefined;
      const a = p ? cards.get(p.a)?.displayName : undefined;
      const b = p ? cards.get(p.b)?.displayName : undefined;
      title = a && b ? `Proposal: ${a} v ${b}` : 'Bout proposal';
    }
    return {
      id: r.id,
      kind: r.kind,
      otherClub,
      title,
      boxer,
      proposalId: r.proposal_id,
      lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
      lastMessage: r.last_body !== null ? { body: r.last_body.length > 160 ? `${r.last_body.slice(0, 157)}…` : r.last_body, fromMe: r.last_sender === me } : null,
      unread: Number(r.unread),
      archived: Boolean(r.archived_at) && !(r.last_message_at && r.archived_at && new Date(r.last_message_at) > new Date(r.archived_at)),
    };
  });
}

const CONV_SELECT = (me: string) => sql`
  select c.id, c.kind, c.club_low_id, c.club_high_id, c.boxer_id, c.proposal_id, c.last_message_at,
         c.last_message_at::text as cursor_at, s.archived_at,
         (select count(*) from messages m
           where m.conversation_id = c.id and m.sender_club_id <> ${me}::uuid
             and m.id > coalesce(s.last_read_message_id, 0))::int as unread,
         lm.body as last_body, lm.sender_club_id as last_sender
  from conversations c
  left join conversation_club_state s on s.conversation_id = c.id and s.club_id = ${me}::uuid
  left join lateral (select m.body, m.sender_club_id from messages m where m.conversation_id = c.id order by m.id desc limit 1) lm on true
  where (c.club_low_id = ${me}::uuid or c.club_high_id = ${me}::uuid)`;

const PAGE = 30;
const CURSOR_TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:\d{2})?|Z)$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Inbox: conversations with at least one message. An archived conversation
 * returns to the inbox when a newer message arrives.
 */
export async function listConversations(
  session: ClubSession,
  opts: { archived?: boolean; cursor?: string | null } = {},
): Promise<{ items: ConversationSummary[]; nextCursor: string | null }> {
  return withClub(session.clubId, async (tx) => {
    const me = session.clubId;
    const [at, cid] = (opts.cursor ?? '').split('|');
    const after = at && cid && opts.cursor!.length <= 80 && CURSOR_TS.test(at) && CURSOR_ID.test(cid) ? { at, id: cid } : null;
    const archivedFilter = opts.archived
      ? sql`s.archived_at is not null and c.last_message_at <= s.archived_at`
      : sql`(s.archived_at is null or c.last_message_at > s.archived_at)`;
    const res = await tx.execute<ConvRow>(sql`
      ${CONV_SELECT(me)}
        and c.last_message_at is not null
        and ${archivedFilter}
        ${after ? sql`and (c.last_message_at, c.id) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql``}
      order by c.last_message_at desc, c.id desc
      limit ${PAGE + 1}`);
    const rows = res.rows.slice(0, PAGE);
    const last = rows[rows.length - 1];
    return { items: await describe(tx, me, rows), nextCursor: res.rows.length > PAGE && last ? `${last.cursor_at}|${last.id}` : null };
  });
}

const THREAD_PAGE = 50;

async function loadMessages(tx: Tx, me: string, conversationId: string, opts: { before?: number; after?: number }): Promise<{ items: MessageView[]; hasEarlier: boolean }> {
  const rows = await tx
    .select({ id: messages.id, body: messages.body, sender: messages.senderClubId, createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        opts.before ? sql`${messages.id} < ${opts.before}` : sql`true`,
        opts.after ? sql`${messages.id} > ${opts.after}` : sql`true`,
      ),
    )
    .orderBy(opts.after ? sql`${messages.id} asc` : sql`${messages.id} desc`)
    .limit(THREAD_PAGE + 1);
  const page = rows.slice(0, THREAD_PAGE);
  const ordered = opts.after ? page : page.reverse();
  return {
    items: ordered.map((m) => ({ id: m.id, body: m.body, fromMe: m.sender === me, createdAt: m.createdAt.toISOString() })),
    hasEarlier: !opts.after && rows.length > THREAD_PAGE,
  };
}

export type ConversationThread = {
  conversation: ConversationSummary;
  messages: MessageView[];
  hasEarlier: boolean;
  lastReadMessageId: number;
};

export async function getConversation(session: ClubSession, id: string): Promise<ConversationThread | null> {
  return withClub(session.clubId, async (tx) => {
    const me = session.clubId;
    const res = await tx.execute<ConvRow>(sql`${CONV_SELECT(me)} and c.id = ${id}::uuid`);
    const row = res.rows[0];
    if (!row) return null;
    const [summary] = await describe(tx, me, [row]);
    const [state] = await tx
      .select({ lastRead: conversationClubState.lastReadMessageId })
      .from(conversationClubState)
      .where(and(eq(conversationClubState.conversationId, id), eq(conversationClubState.clubId, me)));
    const thread = await loadMessages(tx, me, id, {});
    return { conversation: summary!, messages: thread.items, hasEarlier: thread.hasEarlier, lastReadMessageId: Number(state?.lastRead ?? 0) };
  });
}

/** Conversation id attached to a proposal the viewer is party to. */
export async function getProposalThread(session: ClubSession, proposalId: string): Promise<ConversationThread | null> {
  const id = await withClub(session.clubId, async (tx) => {
    const [c] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.proposalId, proposalId));
    return c?.id ?? null;
  });
  return id ? getConversation(session, id) : null;
}

export async function listMessages(session: ClubSession, id: string, opts: { before?: number; after?: number }): Promise<{ items: MessageView[]; hasEarlier: boolean }> {
  const result = await withClub(session.clubId, async (tx) => {
    const [c] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
    if (!c) return null;
    return loadMessages(tx, session.clubId, id, opts);
  });
  if (!result) throw new ApiError('not_found', 'Conversation not found');
  return result;
}

// Write ---------------------------------------------------------------------------

export async function sendMessage(session: ClubSession, id: string, body: string): Promise<MessageView> {
  const result = await withClub(session.clubId, async (tx) => {
    const r = await hit(tx, LIMITS.messageSend, `club:${session.clubId}`);
    if (!r.allowed) throw new ApiError('rate_limited', 'You are sending messages too quickly. Please wait a moment.', undefined, r.retryAfterSeconds);
    const [c] = await tx.select({ id: conversations.id, clubLowId: conversations.clubLowId, clubHighId: conversations.clubHighId }).from(conversations).where(eq(conversations.id, id));
    if (!c) return null;
    // The other club must still be on RingPortal; unapproved/suspended clubs keep history but receive nothing new.
    const other = (await clubNames(tx, [otherOf(c, session.clubId)])).get(otherOf(c, session.clubId));
    if (!other?.approved) throw new ApiError('conflict', 'This club is not currently active on RingPortal, so new messages cannot be sent.');
    const [m] = await tx
      .insert(messages)
      .values({ conversationId: id, senderClubId: session.clubId, senderUserId: session.clubUserId, body })
      .returning({ id: messages.id, createdAt: messages.createdAt });
    await tx.update(conversations).set({ lastMessageAt: m!.createdAt }).where(eq(conversations.id, id));
    await tx
      .insert(conversationClubState)
      .values({ conversationId: id, clubId: session.clubId, lastReadMessageId: m!.id })
      .onConflictDoUpdate({
        target: [conversationClubState.conversationId, conversationClubState.clubId],
        set: { lastReadMessageId: sql`greatest(${conversationClubState.lastReadMessageId}, ${m!.id})`, archivedAt: null },
      });
    return { id: m!.id, body, fromMe: true, createdAt: m!.createdAt.toISOString() };
  });
  if (!result) throw new ApiError('not_found', 'Conversation not found');
  return result;
}

/** Moves the viewer's read position forward (never back), capped at the newest message. */
export async function markRead(session: ClubSession, id: string, upToId: number): Promise<{ lastReadMessageId: number }> {
  const result = await withClub(session.clubId, async (tx) => {
    const [c] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
    if (!c) return null;
    const [{ maxId } = { maxId: 0 }] = await tx
      .select({ maxId: sql<number>`coalesce(max(${messages.id}), 0)::bigint` })
      .from(messages)
      .where(eq(messages.conversationId, id));
    const target = Math.min(upToId, Number(maxId));
    const [s] = await tx
      .insert(conversationClubState)
      .values({ conversationId: id, clubId: session.clubId, lastReadMessageId: target })
      .onConflictDoUpdate({
        target: [conversationClubState.conversationId, conversationClubState.clubId],
        set: { lastReadMessageId: sql`greatest(${conversationClubState.lastReadMessageId}, ${target})` },
      })
      .returning({ lastRead: conversationClubState.lastReadMessageId });
    return { lastReadMessageId: Number(s!.lastRead) };
  });
  if (!result) throw new ApiError('not_found', 'Conversation not found');
  return result;
}

export async function setConversationArchived(session: ClubSession, id: string, archived: boolean): Promise<void> {
  const ok = await withClub(session.clubId, async (tx) => {
    const [c] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
    if (!c) return false;
    const archivedAt = archived ? new Date() : null;
    await tx
      .insert(conversationClubState)
      .values({ conversationId: id, clubId: session.clubId, archivedAt })
      .onConflictDoUpdate({ target: [conversationClubState.conversationId, conversationClubState.clubId], set: { archivedAt } });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Conversation not found');
}

// Notifications -------------------------------------------------------------------

export type NotificationSummary = { unreadMessages: number; unreadConversations: number; proposalsNeedingAction: number };

export async function notificationSummary(session: ClubSession): Promise<NotificationSummary> {
  if (session.clubStatus !== 'approved') return { unreadMessages: 0, unreadConversations: 0, proposalsNeedingAction: 0 };
  return withClub(session.clubId, async (tx) => {
    const me = session.clubId;
    const res = await tx.execute<{ messages: number; conversations: number }>(sql`
      select coalesce(sum(u.n), 0)::int as messages, count(*) filter (where u.n > 0)::int as conversations
      from (
        select (select count(*) from messages m
                 where m.conversation_id = c.id and m.sender_club_id <> ${me}::uuid
                   and m.id > coalesce(s.last_read_message_id, 0)) as n
        from conversations c
        left join conversation_club_state s on s.conversation_id = c.id and s.club_id = ${me}::uuid
        where (c.club_low_id = ${me}::uuid or c.club_high_id = ${me}::uuid) and c.last_message_at is not null
      ) u`);
    return {
      unreadMessages: Number(res.rows[0]?.messages ?? 0),
      unreadConversations: Number(res.rows[0]?.conversations ?? 0),
      proposalsNeedingAction: await countProposalsNeedingAction(tx, me),
    };
  });
}
