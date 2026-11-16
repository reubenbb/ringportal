import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as createShowApi } from '@/app/api/shows/route';
import { PUT as updateShowApi, POST as showStatusApi } from '@/app/api/shows/[id]/route';
import { POST as createRequestApi } from '@/app/api/opponent-requests/route';
import { POST as requestStatusApi } from '@/app/api/opponent-requests/[id]/route';
import { POST as createSparApi } from '@/app/api/sparring/route';
import { POST as sparApi } from '@/app/api/sparring/[id]/route';
import { POST as offerApi } from '@/app/api/sparring/offers/[id]/route';
import { POST as proposeApi } from '@/app/api/proposals/route';
import { POST as proposalActionApi } from '@/app/api/proposals/[id]/route';
import { getShow, listRequests, listShows, publicCalendar } from '@/server/shows/service';
import { getSparring, listSparring } from '@/server/sparring/service';
import { londonToUtc } from '@/lib/shows';
import { closeDb } from '@/server/db/client';
import type { ClubSession } from '@/server/auth/session';
import { PASSWORD, cookieFrom, createBoxer, createClubWithUser, ctx, daysFromNow, idCtx, json, owner, req, uid, yearsAgo } from './helpers';
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
const post = (handler: (r: never, c: never) => Promise<Response>, c: Club | null, path: string, body: unknown, id?: string, method = 'POST') =>
  handler(req(method, path, { cookies: c ? { rp_session: c.cookie } : undefined, body }) as never, (id ? idCtx(id) : ctx) as never);

const showBody = (o: Record<string, unknown> = {}) => ({ name: `Club Show ${uid()}`, date: daysFromNow(40), time: '19:00', venue: 'Town Hall', postcode: 'bn1 1aa', contactRoute: 'Ask for the competition secretary', requirements: '60 kg and 64 kg seniors', info: 'Doors 6pm', listedPublicly: true, ...o });
const requestBody = (o: Record<string, unknown> = {}) => ({ sex: 'male', minAge: 18, maxAge: 30, weightKg: 64, boutType: 'competitive', experience: '0–5 bouts', neededOn: daysFromNow(40), location: 'Brighton', requirements: '', ...o });

describe('shows and the calendar', () => {
  it('an approved club lists, edits and cancels a show; other approved clubs see full details', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const res = await post(createShowApi, a, '/api/shows', showBody());
    expect(res.status).toBe(201);
    const { id } = await json<{ id: string }>(res);
    const seen = (await getShow(b.session, id))!.show;
    expect(seen).toMatchObject({ mine: false, postcode: 'BN1 1AA', contactRoute: 'Ask for the competition secretary', host: { id: a.club.id } });
    expect((await listShows(b.session, 'upcoming')).some((s) => s.id === id)).toBe(true);

    // Only the host can change it.
    expect((await post(updateShowApi, b, `/api/shows/${id}`, showBody({ name: 'Hijacked' }), id, 'PUT')).status).toBe(404);
    expect((await post(showStatusApi, b, `/api/shows/${id}`, { status: 'cancelled' }, id)).status).toBe(404);
    expect((await post(updateShowApi, a, `/api/shows/${id}`, showBody({ name: 'Renamed Show' }), id, 'PUT')).status).toBe(200);
    expect((await getShow(b.session, id))!.show.name).toBe('Renamed Show');
    expect((await post(showStatusApi, a, `/api/shows/${id}`, { status: 'cancelled' }, id)).status).toBe(200);
    expect((await listShows(b.session, 'upcoming')).some((s) => s.id === id)).toBe(false);
    expect((await listShows(a.session, 'mine')).find((s) => s.id === id)!.status).toBe('cancelled');
  });

  it('validates shows and refuses unapproved or signed-out callers', async () => {
    const a = await clubCtx();
    const bad = await post(createShowApi, a, '/api/shows', showBody({ name: 'x', date: '2020-01-01', time: '25:00', postcode: '!!', venue: '' }));
    expect(bad.status).toBe(422);
    expect(Object.keys((await json<{ error: { fields: Record<string, string> } }>(bad)).error.fields).sort()).toEqual(['date', 'name', 'postcode', 'time', 'venue']);
    const pending = await clubCtx('submitted');
    expect((await post(createShowApi, pending, '/api/shows', showBody())).status).toBe(403);
    expect((await post(createShowApi, null, '/api/shows', showBody())).status).toBe(401);
    expect(await listShows(pending.session, 'upcoming')).toEqual([]);
  });

  it('the public calendar shows basic details only, and never demo, unlisted or cancelled shows', async () => {
    const a = await clubCtx();
    const listed = await json<{ id: string }>(await post(createShowApi, a, '/api/shows', showBody()));
    const unlisted = await json<{ id: string }>(await post(createShowApi, a, '/api/shows', showBody({ listedPublicly: false })));
    const demo = await clubCtx();
    await owner.query(`update clubs set is_demo = true where id = $1`, [demo.club.id]);
    const demoShow = await json<{ id: string }>(await post(createShowApi, demo, '/api/shows', showBody()));
    const cal = await publicCalendar();
    const mine = cal.find((s) => s.id === listed.id)!;
    expect(mine).toEqual({ id: listed.id, name: expect.any(String), startsAt: expect.any(String), hostClub: a.club.name, governingBody: 'England Boxing', venue: 'Town Hall', area: 'BN1' });
    expect(JSON.stringify(cal)).not.toMatch(/competition secretary|seniors|Doors 6pm|1AA/);
    expect(cal.some((s) => s.id === unlisted.id || s.id === demoShow.id)).toBe(false);
    await owner.query(`update clubs set status = 'suspended' where id = $1`, [a.club.id]);
    expect((await publicCalendar()).some((s) => s.id === listed.id)).toBe(false);
  });

  it('converts UK local show times to UTC across GMT and BST', () => {
    expect(londonToUtc('2027-01-15', '19:00').toISOString()).toBe('2027-01-15T19:00:00.000Z');
    expect(londonToUtc('2027-07-15', '19:00').toISOString()).toBe('2027-07-15T18:00:00.000Z');
  });
});

describe('opponent requests', () => {
  it('stay open until the club closes them; links must be the club’s own show and boxer', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const show = await json<{ id: string }>(await post(createShowApi, a, '/api/shows', showBody()));
    const boxer = await createBoxer(a.club.id, { firstName: 'Lewis', lastName: 'Carter', dob: yearsAgo(15) });
    const res = await post(createRequestApi, a, '/api/opponent-requests', requestBody({ showId: show.id, boxerId: boxer, minAge: 14, maxAge: 16, weightKg: 48 }));
    expect(res.status).toBe(201);
    const { id } = await json<{ id: string }>(res);
    const seen = (await listRequests(b.session, 'open')).find((r) => r.id === id)!;
    expect(seen).toMatchObject({ mine: false, showId: show.id, weightKg: 48, club: { id: a.club.id } });
    expect(seen.boxer!.displayName).toBe('Lewis C.');
    expect((await getShow(b.session, show.id))!.requests.map((r) => r.id)).toEqual([id]);

    const bShow = await json<{ id: string }>(await post(createShowApi, b, '/api/shows', showBody()));
    const bBoxer = await createBoxer(b.club.id);
    const fields = async (body: Record<string, unknown>) => (await json<{ error: { fields: Record<string, string> } }>(await post(createRequestApi, a, '/api/opponent-requests', requestBody(body)))).error.fields;
    expect(await fields({ showId: bShow.id })).toHaveProperty('showId');
    expect(await fields({ boxerId: bBoxer })).toHaveProperty('boxerId');
    expect(await fields({ minAge: 30, maxAge: 20 })).toHaveProperty('maxAge');

    expect((await post(requestStatusApi, b, `/api/opponent-requests/${id}`, { status: 'closed' }, id)).status).toBe(404);
    expect((await post(requestStatusApi, a, `/api/opponent-requests/${id}`, { status: 'closed' }, id)).status).toBe(200);
    expect((await listRequests(b.session, 'open')).some((r) => r.id === id)).toBe(false);
    expect((await listRequests(a.session, 'mine')).find((r) => r.id === id)!.status).toBe('closed');
  });
});

describe('individual sparring', () => {
  async function scenario() {
    const a = await clubCtx();
    const b = await clubCtx();
    const c = await clubCtx();
    const aBoxer = await createBoxer(a.club.id, { firstName: 'Jack', lastName: 'Thompson', dob: yearsAgo(24), weightKg: 64 });
    const bBoxer = await createBoxer(b.club.id, { firstName: 'Ryan', lastName: 'Patel', dob: yearsAgo(25), weightKg: 65 });
    const cBoxer = await createBoxer(c.club.id, { dob: yearsAgo(23), weightKg: 63 });
    const { id } = await json<{ id: string }>(await post(createSparApi, a, '/api/sparring', { boxerId: aBoxer, availabilityNote: 'Tuesday evenings', location: 'Brighton' }));
    return { a, b, c, aBoxer, bBoxer, cBoxer, id };
  }
  const offer = (c: Club, id: string, boxerId: string) => post(sparApi, c, `/api/sparring/${id}`, { action: 'offer', boxerId, note: 'Good fit' }, id);
  const decide = (c: Club, offerId: string, body: Record<string, unknown>) => post(offerApi, c, `/api/sparring/offers/${offerId}`, body, offerId);

  it('one boxer, one partner: offer, approve, private attendance', async () => {
    const s = await scenario();
    expect((await post(createSparApi, s.a, '/api/sparring', { boxerId: s.aBoxer })).status).toBe(409); // one open request per boxer
    expect((await post(createSparApi, s.a, '/api/sparring', { boxerId: s.bBoxer })).status).toBe(422); // not your boxer

    const forB = (await getSparring(s.b.session, s.id))!;
    expect(forB.suggestions.map((x) => x.boxer.id)).toEqual([s.bBoxer]);
    expect(forB.request.boxer!.displayName).toBe('Jack Thompson');

    const junior = await createBoxer(s.b.club.id, { dob: yearsAgo(16), weightKg: 64 });
    expect((await offer(s.b, s.id, junior)).status).toBe(422); // adult v under-18 gate
    expect((await offer(s.b, s.id, s.cBoxer)).status).toBe(422); // not B's boxer
    expect((await offer(s.a, s.id, s.aBoxer)).status).toBe(404); // cannot offer on your own request
    const ob = await json<{ id: string }>(await offer(s.b, s.id, s.bBoxer));
    expect((await offer(s.b, s.id, s.bBoxer)).status).toBe(409); // duplicate
    const oc = await json<{ id: string }>(await offer(s.c, s.id, s.cBoxer));

    // Offering clubs see only their own offer; the requester sees both.
    expect((await getSparring(s.b.session, s.id))!.offers.map((o) => o.id)).toEqual([ob.id]);
    expect((await getSparring(s.a.session, s.id))!.offers.map((o) => o.id).sort()).toEqual([ob.id, oc.id].sort());

    expect((await decide(s.b, ob.id, { action: 'approve' })).status).toBe(409); // only the requester decides
    expect((await decide(s.c, ob.id, { action: 'withdraw' })).status).toBe(404); // not a party
    expect((await decide(s.a, ob.id, { action: 'attendance', sessionDate: daysFromNow(-1), attended: true })).status).toBe(409); // not approved yet
    expect(await json(await decide(s.a, ob.id, { action: 'approve' }))).toEqual({ status: 'approved' });
    const after = (await getSparring(s.a.session, s.id))!;
    expect(after.request.status).toBe('arranged');
    expect(after.offers.find((o) => o.id === oc.id)!.status).toBe('declined');
    expect((await decide(s.a, oc.id, { action: 'approve' })).status).toBe(409);
    expect((await listSparring(s.c.session)).open.some((r) => r.id === s.id)).toBe(false);

    // Attendance is private to each club.
    expect((await decide(s.a, ob.id, { action: 'attendance', sessionDate: daysFromNow(-1), attended: true, note: 'Three rounds' })).status).toBe(200);
    expect((await decide(s.a, ob.id, { action: 'attendance', sessionDate: daysFromNow(3), attended: true })).status).toBe(422);
    expect((await getSparring(s.a.session, s.id))!.attendance).toHaveLength(1);
    expect((await getSparring(s.b.session, s.id))!.attendance).toEqual([]);

    // If the approved partner withdraws, the requester can reopen.
    expect((await post(sparApi, s.a, `/api/sparring/${s.id}`, { action: 'reopen' }, s.id)).status).toBe(409);
    expect((await decide(s.b, ob.id, { action: 'withdraw' })).status).toBe(200);
    expect((await post(sparApi, s.a, `/api/sparring/${s.id}`, { action: 'reopen' }, s.id)).status).toBe(200);
    expect((await post(sparApi, s.b, `/api/sparring/${s.id}`, { action: 'close' }, s.id)).status).toBe(404);
  });

  it('database rules hold with the application bypassed', async () => {
    const s = await scenario();
    const ob = await json<{ id: string }>(await offer(s.b, s.id, s.bBoxer));
    const app = new Client({ connectionString: TEST_APP_URL });
    await app.connect();
    try {
      const as = async (clubId: string) => {
        await app.query('begin');
        await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [clubId]);
      };
      await as(s.c.club.id);
      expect((await app.query(`select 1 from sparring_offers where id = $1`, [ob.id])).rowCount).toBe(0);
      expect((await app.query(`update sparring_requests set status = 'closed' where id = $1`, [s.id])).rowCount).toBe(0);
      expect((await app.query(`update shows set name = 'x'`)).rowCount).toBe(0);
      await app.query('rollback');
      await as(s.b.club.id);
      await expect(app.query(`update sparring_offers set status = 'approved' where id = $1`, [ob.id])).rejects.toThrow(/only the requesting club/);
      await app.query('rollback');
      await as(s.b.club.id);
      await expect(app.query(`insert into sparring_attendance (offer_id, club_id, session_date, attended) values ($1, $2, current_date, true)`, [ob.id, s.b.club.id])).rejects.toThrow(/row-level security/);
      await app.query('rollback');
    } finally {
      await app.end();
    }
  });
});

describe('boxer availability follows a confirmed bout', () => {
  it('marks both boxers Confirmed, and Ready again if the bout is withdrawn', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const aBoxer = await createBoxer(a.club.id, { dob: yearsAgo(24) });
    const bBoxer = await createBoxer(b.club.id, { dob: yearsAgo(24) });
    const { id } = await json<{ id: string }>(await post(proposeApi, a, '/api/proposals', { proposingBoxerId: aBoxer, receivingBoxerId: bBoxer, weightKg: 64, boutType: 'competitive' }));
    const act = (c: Club, body: Record<string, unknown>) => post(proposalActionApi, c, `/api/proposals/${id}`, body, id);
    const availability = async () => (await owner.query(`select availability from boxers where id = any($1) order by id`, [[aBoxer, bBoxer]])).rows.map((r) => r.availability);
    await act(b, { action: 'accept', expectedVersion: 1 });
    await act(a, { action: 'confirm', expectedVersion: 1 });
    expect(await availability()).toEqual(['ready', 'ready']);
    await act(b, { action: 'confirm', expectedVersion: 1 });
    expect(await availability()).toEqual(['confirmed', 'confirmed']);
    await act(a, { action: 'withdraw' });
    expect(await availability()).toEqual(['ready', 'ready']);
    const hist = await owner.query(`select to_status from boxer_availability_history where boxer_id = $1 order by id`, [aBoxer]);
    expect(hist.rows.map((r) => r.to_status)).toEqual(['confirmed', 'ready']);
  });
});
