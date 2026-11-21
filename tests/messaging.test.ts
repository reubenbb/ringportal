import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as openApi } from '@/app/api/conversations/route';
import { GET as listApi, POST as sendApi } from '@/app/api/conversations/[id]/messages/route';
import { POST as readApi } from '@/app/api/conversations/[id]/read/route';
import { POST as archiveApi } from '@/app/api/conversations/[id]/archive/route';
import { GET as notificationsApi } from '@/app/api/notifications/route';
import { POST as proposalApi } from '@/app/api/proposals/route';
import { getConversation, listConversations, notificationSummary } from '@/server/messaging/service';
import { closeDb } from '@/server/db/client';
import type { ClubSession } from '@/server/auth/session';
import { PASSWORD, cookieFrom, createBoxer, createClubWithUser, ctx, daysFromNow, idCtx, json, owner, req, yearsAgo } from './helpers';
import { TEST_APP_URL } from './test-config';

afterAll(async () => {
  await closeDb();
});

type Club = Awaited<ReturnType<typeof clubCtx>>;

async function clubCtx(status = 'approved') {
  const { club, user } = await createClubWithUser({ status });
  const cookie = cookieFrom(await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
  const session: ClubSession = {
    sessionId: '',
    clubUserId: user.id,
    clubId: club.id,
    email: user.email,
    clubName: club.name,
    clubSlug: club.slug,
    clubStatus: status as ClubSession['clubStatus'],
    isDemoClub: false,
  };
  return { club, user, cookie, session };
}

const open = (c: Club, body: unknown) => openApi(req('POST', '/api/conversations', { cookies: { rp_session: c.cookie }, body }), ctx);
const send = (c: Club, id: string, body: string) =>
  sendApi(req('POST', `/api/conversations/${id}/messages`, { cookies: { rp_session: c.cookie }, body: { body } }), idCtx(id));
const list = (c: Club, id: string, query = '') => listApi(req('GET', `/api/conversations/${id}/messages${query}`, { cookies: { rp_session: c.cookie } }), idCtx(id));
const markRead = (c: Club, id: string, upToId: number) =>
  readApi(req('POST', `/api/conversations/${id}/read`, { cookies: { rp_session: c.cookie }, body: { upToId } }), idCtx(id));
const archive = (c: Club, id: string, archived: boolean) =>
  archiveApi(req('POST', `/api/conversations/${id}/archive`, { cookies: { rp_session: c.cookie }, body: { archived } }), idCtx(id));

async function general(a: Club, b: Club) {
  const res = await open(a, { kind: 'general', clubId: b.club.id });
  expect(res.status).toBe(200);
  return (await json<{ id: string }>(res)).id;
}

describe('opening conversations', () => {
  it('finds or creates one general conversation per pair of clubs, from either side and under concurrency', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const ids = await Promise.all([general(a, b), general(a, b), general(b, a)]);
    expect(new Set(ids).size).toBe(1);
  });

  it('opens a boxer conversation for another approved club’s active boxer only', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const bBoxer = await createBoxer(b.club.id);
    const first = await json<{ id: string }>(await open(a, { kind: 'boxer', boxerId: bBoxer }));
    const again = await json<{ id: string }>(await open(a, { kind: 'boxer', boxerId: bBoxer }));
    expect(first.id).toBe(again.id);
    expect(first.id).not.toBe(await general(a, b));

    const own = await createBoxer(a.club.id);
    expect((await open(a, { kind: 'boxer', boxerId: own })).status).toBe(404);
    const archived = await createBoxer(b.club.id, { archived: true });
    expect((await open(a, { kind: 'boxer', boxerId: archived })).status).toBe(404);
    const pending = await clubCtx('submitted');
    expect((await open(a, { kind: 'general', clubId: pending.club.id })).status).toBe(404);
    expect((await open(a, { kind: 'general', clubId: a.club.id })).status).toBe(404);
    expect((await open(pending, { kind: 'general', clubId: a.club.id })).status).toBe(403);
  });
});

describe('sending and reading messages', () => {
  it('delivers a message only to the two clubs, with unread counts, read position and polling', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const c = await clubCtx();
    const id = await general(a, b);

    const sent = await send(a, id, '  Hello from Club A.\r\nAny boxers around 64 kg?  ');
    expect(sent.status).toBe(201);
    const m1 = await json<{ id: number; body: string; fromMe: boolean }>(sent);
    expect(m1).toMatchObject({ body: 'Hello from Club A.\nAny boxers around 64 kg?', fromMe: true });

    expect(await notificationSummary(b.session)).toMatchObject({ unreadMessages: 1, unreadConversations: 1 });
    expect(await notificationSummary(a.session)).toMatchObject({ unreadMessages: 0 });
    const inboxB = await listConversations(b.session);
    expect(inboxB.items).toHaveLength(1);
    expect(inboxB.items[0]).toMatchObject({ id, kind: 'general', unread: 1, otherClub: { id: a.club.id, name: a.club.name }, lastMessage: { fromMe: false } });

    // Third club: nothing.
    expect((await list(c, id)).status).toBe(404);
    expect((await send(c, id, 'hi')).status).toBe(404);
    expect((await markRead(c, id, m1.id)).status).toBe(404);
    expect((await archive(c, id, true)).status).toBe(404);
    expect(await getConversation(c.session, id)).toBeNull();
    expect((await listConversations(c.session)).items).toHaveLength(0);
    expect(await notificationSummary(c.session)).toMatchObject({ unreadMessages: 0 });

    const m2 = await json<{ id: number }>(await send(b, id, 'Yes, we have one.'));
    const polled = await json<{ items: { id: number; fromMe: boolean }[] }>(await list(a, id, `?after=${m1.id}`));
    expect(polled.items).toEqual([expect.objectContaining({ id: m2.id, fromMe: false })]);

    // Reading: capped at the newest message, never moves backwards.
    expect(await json(await markRead(a, id, Number.MAX_SAFE_INTEGER))).toEqual({ lastReadMessageId: m2.id });
    expect(await json(await markRead(a, id, 0))).toEqual({ lastReadMessageId: m2.id });
    expect(await notificationSummary(a.session)).toMatchObject({ unreadMessages: 0 });
    // Replying moves B's read position past A's message too.
    expect(await notificationSummary(b.session)).toMatchObject({ unreadMessages: 0 });

    await send(b, id, 'Shall we propose a date?');
    const res = await notificationsApi(req('GET', '/api/notifications', { cookies: { rp_session: a.cookie } }), ctx);
    expect(await json(res)).toEqual({ unreadMessages: 1, unreadConversations: 1, proposalsNeedingAction: 0, transfersNeedingAction: 0 });
  });

  it('validates message bodies and query cursors', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const id = await general(a, b);
    expect((await send(a, id, '   ')).status).toBe(422);
    expect((await send(a, id, 'x'.repeat(2001))).status).toBe(422);
    expect((await send(a, id, 'x'.repeat(2000))).status).toBe(201);
    expect((await list(a, id, '?after=abc')).status).toBe(400);
    expect((await list(a, 'not-a-uuid')).status).toBe(404);
    // Stored as plain text; rendering escapes it.
    const html = await json<{ body: string }>(await send(a, id, '<script>alert(1)</script>'));
    expect(html.body).toBe('<script>alert(1)</script>');
  });

  it('pages through earlier messages', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const id = await general(a, b);
    for (let i = 1; i <= 55; i++) await owner.query(`insert into messages (conversation_id, sender_club_id, body) values ($1, $2, $3)`, [id, a.club.id, `m${i}`]);
    await owner.query(`update conversations set last_message_at = now() where id = $1`, [id]);
    const thread = await getConversation(b.session, id);
    expect(thread!.messages).toHaveLength(50);
    expect(thread!.messages[0]!.body).toBe('m6');
    expect(thread!.messages.at(-1)!.body).toBe('m55');
    expect(thread!.hasEarlier).toBe(true);
    const earlier = await json<{ items: { body: string }[]; hasEarlier: boolean }>(await list(b, id, `?before=${thread!.messages[0]!.id}`));
    expect(earlier.items.map((m) => m.body)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(earlier.hasEarlier).toBe(false);
  });

  it('archive is per club; a newer message brings the conversation back to the inbox', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const id = await general(a, b);
    await send(a, id, 'First');
    expect((await archive(b, id, true)).status).toBe(200);
    expect((await listConversations(b.session)).items).toHaveLength(0);
    expect((await listConversations(b.session, { archived: true })).items.map((c) => c.id)).toEqual([id]);
    expect((await listConversations(a.session)).items).toHaveLength(1); // A unaffected
    await new Promise((r) => setTimeout(r, 5));
    await send(a, id, 'Second');
    expect((await listConversations(b.session)).items.map((c) => c.id)).toEqual([id]);
    expect((await listConversations(b.session, { archived: true })).items).toHaveLength(0);
  });

  it('stops new messages to a club that is no longer approved, but keeps history', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const id = await general(a, b);
    await send(a, id, 'Before suspension');
    await owner.query(`update clubs set status = 'suspended' where id = $1`, [b.club.id]);
    expect((await send(a, id, 'After suspension')).status).toBe(409);
    expect((await getConversation(a.session, id))!.messages.map((m) => m.body)).toEqual(['Before suspension']);
  });

  it('rate-limits sending', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const id = await general(a, b);
    const statuses: number[] = [];
    for (let i = 0; i < 41; i++) statuses.push((await send(a, id, `msg ${i}`)).status);
    expect(statuses.slice(0, 40).every((s) => s === 201)).toBe(true);
    expect(statuses[40]).toBe(429);
  });
});

describe('proposal conversations', () => {
  it('a proposal’s message starts its thread, titled by the two boxers', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    // Both juniors: under-18s are only proposed against under-18s.
    const aBoxer = await createBoxer(a.club.id, { firstName: 'Jack', lastName: 'Thompson', dob: yearsAgo(15) });
    const bBoxer = await createBoxer(b.club.id, { firstName: 'Lewis', lastName: 'Carter', dob: yearsAgo(15) });
    const res = await proposalApi(
      req('POST', '/api/proposals', {
        cookies: { rp_session: a.cookie },
        body: { proposingBoxerId: aBoxer, receivingBoxerId: bBoxer, weightKg: 48, boutType: 'skills', proposedDate: daysFromNow(10), message: 'Would this work?' },
      }),
      ctx,
    );
    expect(res.status).toBe(201);
    const [conv] = (await listConversations(b.session)).items;
    expect(conv).toMatchObject({ kind: 'proposal', title: 'Proposal: Jack T. v Lewis Carter', unread: 1 });
    const [convA] = (await listConversations(a.session)).items;
    expect(convA!.title).toBe('Proposal: Jack Thompson v Lewis C.');
  });
});

describe('messaging database policies', () => {
  it('hold even if the application layer is bypassed', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const c = await clubCtx();
    const id = await general(a, b);
    const { id: msgId } = await json<{ id: number }>(await send(a, id, 'Private'));
    const app = new Client({ connectionString: TEST_APP_URL });
    await app.connect();
    try {
      const as = async (clubId: string) => {
        await app.query('begin');
        await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [clubId]);
      };
      await as(c.club.id);
      expect((await app.query(`select * from messages where conversation_id = $1`, [id])).rowCount).toBe(0);
      await expect(app.query(`insert into messages (conversation_id, sender_club_id, body) values ($1, $2, 'x')`, [id, c.club.id])).rejects.toThrow(/row-level security/);
      await app.query('rollback');

      // A party cannot impersonate the other club, edit or delete messages, or read the other club's read state.
      await as(b.club.id);
      await expect(app.query(`insert into messages (conversation_id, sender_club_id, body) values ($1, $2, 'x')`, [id, a.club.id])).rejects.toThrow(/row-level security/);
      await app.query('rollback');
      await as(a.club.id);
      await expect(app.query(`update messages set body = 'edited' where id = $1`, [msgId])).rejects.toThrow(/permission denied/);
      await app.query('rollback');
      await as(a.club.id);
      await expect(app.query(`delete from messages where id = $1`, [msgId])).rejects.toThrow(/permission denied/);
      await app.query('rollback');
      await as(b.club.id);
      expect((await app.query(`select * from conversation_club_state where conversation_id = $1`, [id])).rows.every((r) => r.club_id === b.club.id)).toBe(true);
      await app.query('rollback');
      await as(a.club.id);
      await expect(app.query(`update conversations set club_high_id = $2 where id = $1`, [id, c.club.id])).rejects.toThrow(/cannot be changed|row-level security/);
      await app.query('rollback');
      await expect(owner.query(`update messages set body = 'edited' where id = $1`, [msgId])).rejects.toThrow(/append-only/);
    } finally {
      await app.end();
    }
  });
});
