import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as blockApi } from '@/app/api/clubs/[id]/block/route';
import { PUT as profileApi } from '@/app/api/club/profile/route';
import { POST as openApi } from '@/app/api/conversations/route';
import { POST as sendApi } from '@/app/api/conversations/[id]/messages/route';
import { POST as proposeApi } from '@/app/api/proposals/route';
import { POST as createSparApi } from '@/app/api/sparring/route';
import { POST as sparApi } from '@/app/api/sparring/[id]/route';
import { GET as cronApi } from '@/app/api/cron/affiliation-expiry/route';
import { getBlockState, listMyBlocks } from '@/server/clubs/blocks';
import { getClubProfile } from '@/server/clubs/profile';
import { runAffiliationExpiry } from '@/server/clubs/expiry';
import { searchMatches, matchQuerySchema } from '@/server/matchmaking/service';
import { parseMonth, shiftMonth, currentMonth } from '@/components/shows/month-grid';
import { closeDb } from '@/server/db/client';
import type { ClubSession } from '@/server/auth/session';
import { PASSWORD, cookieFrom, createBoxer, createClub, createClubWithUser, ctx, idCtx, json, owner, req, yearsAgo } from './helpers';
import { TEST_APP_URL } from './test-config';

afterAll(async () => {
  await closeDb();
});

type Club = Awaited<ReturnType<typeof clubCtx>>;
async function clubCtx(status = 'approved') {
  const { club, user } = await createClubWithUser({ status });
  const cookie = cookieFrom(await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
  const session: ClubSession = { sessionId: '', clubUserId: user.id, clubId: club.id, email: user.email, clubName: club.name, clubSlug: club.slug, clubStatus: status as ClubSession['clubStatus'], isDemoClub: false };
  return { club, user, cookie, session };
}
const call = (handler: (r: never, c: never) => Promise<Response>, c: Club, path: string, body: unknown, id?: string, method = 'POST') =>
  handler(req(method, path, { cookies: { rp_session: c.cookie }, body }) as never, (id ? idCtx(id) : ctx) as never);

describe('blocking a club', () => {
  it('stops messages, new conversations, proposals, sparring offers and matchmaking both ways; unblock restores', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const conv = await json<{ id: string }>(await call(openApi, a, '/api/conversations', { kind: 'general', clubId: b.club.id }));
    const aBoxer = await createBoxer(a.club.id, { dob: yearsAgo(24), weightKg: 111.1 });
    const bBoxer = await createBoxer(b.club.id, { dob: yearsAgo(24), weightKg: 111.1 });
    const spar = await json<{ id: string }>(await call(createSparApi, a, '/api/sparring', { boxerId: aBoxer }));

    expect((await call(blockApi, b, `/api/clubs/${b.club.id}/block`, { blocked: true }, b.club.id)).status).toBe(400);
    expect((await call(blockApi, b, `/api/clubs/${a.club.id}/block`, { blocked: true }, a.club.id)).status).toBe(200);
    expect(await getBlockState(b.session, a.club.id)).toBe('mine');
    expect(await getBlockState(a.session, b.club.id)).toBe('theirs');
    expect((await listMyBlocks(b.session)).map((x) => x.id)).toEqual([a.club.id]);
    expect(await listMyBlocks(a.session)).toEqual([]); // A cannot see B's block list

    for (const c of [a, b]) {
      const send = await call(sendApi, c, `/api/conversations/${conv.id}/messages`, { body: 'Hello?' }, conv.id);
      expect(send.status).toBe(409);
    }
    expect((await json<{ error: { message: string } }>(await call(sendApi, a, `/api/conversations/${conv.id}/messages`, { body: 'Hi' }, conv.id))).error.message).toBe('You cannot contact this club.');
    expect((await call(openApi, a, '/api/conversations', { kind: 'boxer', boxerId: bBoxer })).status).toBe(409);
    expect((await call(proposeApi, a, '/api/proposals', { proposingBoxerId: aBoxer, receivingBoxerId: bBoxer, weightKg: 111, boutType: 'competitive' })).status).toBe(409);
    expect((await call(sparApi, b, `/api/sparring/${spar.id}`, { action: 'offer', boxerId: bBoxer }, spar.id)).status).toBe(409);
    expect((await searchMatches(a.session, aBoxer, matchQuerySchema.parse({})))!.suitable.map((r) => r.id)).not.toContain(bBoxer);
    expect((await searchMatches(b.session, bBoxer, matchQuerySchema.parse({})))!.suitable.map((r) => r.id)).not.toContain(aBoxer);

    // Enforced in the database too.
    const app = new Client({ connectionString: TEST_APP_URL });
    await app.connect();
    try {
      await app.query('begin');
      await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [a.club.id]);
      await expect(app.query(`insert into messages (conversation_id, sender_club_id, body) values ($1, $2, 'x')`, [conv.id, a.club.id])).rejects.toThrow(/row-level security/);
      await app.query('rollback');
      await app.query('begin');
      await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [a.club.id]);
      expect((await app.query(`delete from club_blocks`)).rowCount).toBe(0); // cannot remove B's block
      await app.query('rollback');
    } finally {
      await app.end();
    }

    expect((await call(blockApi, b, `/api/clubs/${a.club.id}/block`, { blocked: false }, a.club.id)).status).toBe(200);
    expect((await call(sendApi, a, `/api/conversations/${conv.id}/messages`, { body: 'Back in touch' }, conv.id)).status).toBe(201);
    const actions = await owner.query(`select action from audit_log where club_id = $1 and action like 'club.%block%' order by id`, [b.club.id]);
    expect(actions.rows.map((r) => r.action)).toEqual(['club.blocked', 'club.unblocked']);
  });
});

describe('club profile', () => {
  it('a club edits its own profile fields only; approved clubs can read it', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const pending = await clubCtx('submitted');
    const put = (c: Club, body: Record<string, unknown>) => call(profileApi, c, '/api/club/profile', body, undefined, 'PUT');
    const bad = await put(a, { website: 'javascript:alert(1)', contactEmail: 'nope' });
    expect(bad.status).toBe(422);
    expect(Object.keys((await json<{ error: { fields: Record<string, string> } }>(bad)).error.fields).sort()).toEqual(['contactEmail', 'website']);
    expect((await put(a, { about: 'Friendly club', website: 'https://club.example', contactEmail: 'Info@Club.Example', trainingVenue: 'Town Hall', status: 'approved', name: 'Renamed' })).status).toBe(200);
    expect(await getClubProfile(b.session, a.club.id)).toEqual({ region: null, about: 'Friendly club', website: 'https://club.example', contactEmail: 'info@club.example', trainingVenue: 'Town Hall' });
    expect((await owner.query(`select name from clubs where id = $1`, [a.club.id])).rows[0].name).toBe(a.club.name);
    expect(await getClubProfile(pending.session, a.club.id)).toBeNull();
    expect(await getClubProfile(a.session, pending.club.id)).toBeNull();
    expect(await getClubProfile(pending.session, pending.club.id)).not.toBeNull();
  });
});

describe('affiliation expiry', () => {
  it('moves approved clubs past their expiry date to re-verification, once, with an audit entry', async () => {
    const expired = await createClub();
    const current = await createClub();
    const suspended = await createClub({ status: 'suspended' });
    await owner.query(`update clubs set affiliation_expires_on = current_date - 2 where id = any($1)`, [[expired.id, suspended.id]]);
    await owner.query(`update clubs set affiliation_expires_on = current_date + 30 where id = $1`, [current.id]);
    const first = await runAffiliationExpiry();
    expect(first.moved).toContain(expired.id);
    expect(first.moved).not.toContain(current.id);
    expect(first.moved).not.toContain(suspended.id);
    expect((await owner.query(`select status, status_reason from clubs where id = $1`, [expired.id])).rows[0]).toMatchObject({ status: 'reverification_required', status_reason: expect.stringContaining('expiry date') });
    expect((await runAffiliationExpiry()).moved).not.toContain(expired.id);
    expect((await owner.query(`select actor_type from audit_log where action = 'club.affiliation_expired' and target_id = $1`, [expired.id])).rows).toEqual([{ actor_type: 'system' }]);
  });

  it('the scheduled endpoint needs the cron secret', async () => {
    const run = (auth?: string) => cronApi(req('GET', '/api/cron/affiliation-expiry', { headers: auth ? { authorization: auth } : {} }), ctx);
    expect((await run()).status).toBe(401);
    expect((await run('Bearer wrong-secret')).status).toBe(401);
    expect((await run('Bearer test-cron-secret-0123456789abcdef0123456789x')).status).toBe(401);
    const ok = await run('Bearer test-cron-secret-0123456789abcdef0123456789');
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ moved: expect.any(Number) });
  });
});

describe('month grid helpers', () => {
  it('clamps to upcoming months and steps across years', () => {
    expect(parseMonth('2020-01')).toBe(currentMonth());
    expect(parseMonth('not-a-month')).toBe(currentMonth());
    expect(parseMonth('2099-12')).toBe('2099-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });
});
