import { afterAll, describe, expect, it } from 'vitest';
import { POST as registerApi } from '@/app/api/auth/register/route';
import { GET as lookupApi } from '@/app/api/auth/register/directory/route';
import { POST as decideApi } from '@/app/api/admin/clubs/[id]/route';
import { POST as createBoxerApi } from '@/app/api/boxers/route';
import { decideClub, getClubForAdmin, listClubsForAdmin } from '@/server/clubs/admin';
import { closeDb } from '@/server/db/client';
import type { AdminSession } from '@/server/auth/session';
import { cookieFrom, createClub, createPlatformUser, ctx, idCtx, json, owner, req, uid } from './helpers';

afterAll(async () => {
  await closeDb();
});

const PW = 'a-long-registration-password';
const body = (o: Record<string, unknown> = {}) => ({ clubName: `New Club ${uid()}`, governingBodyId: 1, affiliationNumber: '', directoryClubId: null, email: `reg-${uid()}@example.test`, password: PW, authorised: true, ...o });
const register = (b: Record<string, unknown>, ip?: string) => registerApi(req('POST', '/api/auth/register', { body: b, ip }), ctx);
const fields = async (res: Response) => (await json<{ error: { fields: Record<string, string> } }>(res)).error.fields;

async function directoryClub(name = `Directory Club ${uid()}`, body = 1) {
  const { rows } = await owner.query<{ id: string }>(
    `insert into directory_clubs (source, source_ref, source_url, name, slug, governing_body_id, region) values ('england_boxing_directory', $1, 'https://example.test/d', $2, $3, $4, 'Test Region') returning id`,
    [`ref-${uid()}`, name, `dir-${uid()}`, body],
  );
  return { id: rows[0]!.id, name };
}

async function admin(): Promise<AdminSession> {
  const u = await createPlatformUser();
  return { sessionId: '', platformUserId: u.id, email: u.email, displayName: 'Test Admin', role: 'admin' };
}
const meta = { ipHash: 'test' };

describe('club registration', () => {
  it('creates a submitted club with a login and session, but no verified features', async () => {
    const b = body({ affiliationNumber: `EB-${uid()}` });
    const res = await register(b);
    expect(res.status).toBe(201);
    const cookie = cookieFrom(res, 'rp_session')!;
    expect(cookie).toBeTruthy();
    const { rows } = await owner.query(`select c.status, c.is_demo, u.password_hash from clubs c join club_users u on u.club_id = c.id where u.email = $1`, [b.email]);
    expect(rows[0]).toMatchObject({ status: 'submitted', is_demo: false });
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    // Signed in, but not approved: verified features refuse.
    const boxer = await createBoxerApi(req('POST', '/api/boxers', { cookies: { rp_session: cookie }, body: {} }), ctx);
    expect(boxer.status).toBe(403);
    const audit = await owner.query(`select metadata from audit_log where action = 'club.registered' order by id desc limit 1`);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(PW);
  });

  it('validates input and cannot set status, demo flag or approval through the body', async () => {
    const res = await register(body({ clubName: 'x', governingBodyId: 999, email: 'nope', password: 'short', authorised: false, affiliationNumber: '<script>' }));
    expect(res.status).toBe(422);
    expect(Object.keys(await fields(res)).sort()).toEqual(['affiliationNumber', 'authorised', 'clubName', 'email', 'password']);
    expect(await fields(await register(body({ governingBodyId: 999 })))).toHaveProperty('governingBodyId');
    const b = body({ status: 'approved', isDemo: true, is_demo: true });
    expect((await register(b)).status).toBe(201);
    const { rows } = await owner.query(`select c.status, c.is_demo from clubs c join club_users u on u.club_id = c.id where u.email = $1`, [b.email]);
    expect(rows[0]).toEqual({ status: 'submitted', is_demo: false });
  });

  it('prevents duplicate emails, affiliation numbers and competing directory claims', async () => {
    const aff = `EB-${uid()}`;
    const d = await directoryClub();
    const first = body({ affiliationNumber: aff, directoryClubId: d.id });
    expect((await register(first)).status).toBe(201);
    expect(await fields(await register(body({ email: first.email })))).toHaveProperty('email');
    expect(await fields(await register(body({ affiliationNumber: aff.toLowerCase() })))).toHaveProperty('affiliationNumber');
    expect(await fields(await register(body({ directoryClubId: d.id })))).toHaveProperty('directoryClubId');
    const scottish = await directoryClub(undefined, 2);
    expect(await fields(await register(body({ directoryClubId: scottish.id })))).toHaveProperty('directoryClubId');
    // The claim is only a request: the directory record is not linked yet.
    const { rows } = await owner.query(`select claim_status, club_id from directory_clubs where id = $1`, [d.id]);
    expect(rows[0]).toEqual({ claim_status: 'unclaimed', club_id: null });
  });

  it('directory lookup returns unclaimed names only and needs three characters', async () => {
    const tag = `Zq${uid()}`;
    const free = await directoryClub(`${tag} Free ABC`);
    const taken = await directoryClub(`${tag} Taken ABC`);
    await register(body({ directoryClubId: taken.id }));
    const lookup = async (q: string) => (await json<{ items: Record<string, unknown>[] }>(await lookupApi(req('GET', `/api/auth/register/directory?q=${encodeURIComponent(q)}`), ctx))).items;
    expect(await lookup(tag)).toEqual([{ id: free.id, name: free.name, region: 'Test Region' }]);
    expect(await lookup('ab')).toEqual([]);
    expect(await lookup('%%%')).toEqual([]);
  });

  it('rate-limits registrations per connection', async () => {
    const ip = '10.99.99.1';
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await register(body(), ip)).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });
});

describe('admin approval and claims', () => {
  it('approving a club links its claimed directory record and is audited', async () => {
    const a = await admin();
    const d = await directoryClub();
    const b = body({ directoryClubId: d.id });
    await register(b);
    const { rows } = await owner.query<{ id: string }>(`select club_id as id from club_users where email = $1`, [b.email]);
    const clubId = rows[0]!.id;
    expect((await listClubsForAdmin({ filter: 'review', q: b.clubName as string })).rows[0]).toMatchObject({ id: clubId, pendingClaim: d.name });

    expect(await decideClub(a, clubId, { action: 'review', reason: null, affiliationExpiresOn: null }, meta)).toEqual({ status: 'under_review' });
    await expect(decideClub(a, clubId, { action: 'review', reason: null, affiliationExpiresOn: null }, meta)).rejects.toMatchObject({ code: 'conflict' });
    await expect(decideClub(a, clubId, { action: 'suspend', reason: 'Not allowed from this status', affiliationExpiresOn: null }, meta)).rejects.toMatchObject({ code: 'conflict' });
    await expect(decideClub(a, clubId, { action: 'reject', reason: null, affiliationExpiresOn: null }, meta)).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(decideClub(a, clubId, { action: 'approve', reason: null, affiliationExpiresOn: '2020-01-01' }, meta)).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await decideClub(a, clubId, { action: 'approve', reason: 'Affiliation checked', affiliationExpiresOn: '2099-12-31' }, meta)).toEqual({ status: 'approved' });

    const dir = await owner.query(`select claim_status, club_id from directory_clubs where id = $1`, [d.id]);
    expect(dir.rows[0]).toEqual({ claim_status: 'claimed', club_id: clubId });
    const detail = (await getClubForAdmin(clubId))!;
    expect(detail).toMatchObject({ status: 'approved', affiliationExpiresOn: '2099-12-31' });
    expect(detail.claims[0]).toMatchObject({ status: 'approved' });
    expect(detail.history.map((h) => h.action)).toEqual(['club.approve', 'club.review', 'club.registered']);
    const audit = await owner.query(`select actor_id, reason, metadata from audit_log where action = 'club.approve' and target_id = $1`, [clubId]);
    expect(audit.rows[0]).toMatchObject({ actor_id: a.platformUserId, reason: 'Affiliation checked', metadata: { from: 'under_review', to: 'approved', claim: 'approved' } });

    expect(await decideClub(a, clubId, { action: 'suspend', reason: 'Affiliation withdrawn', affiliationExpiresOn: null }, meta)).toEqual({ status: 'suspended' });
    expect(await decideClub(a, clubId, { action: 'reinstate', reason: 'Affiliation restored', affiliationExpiresOn: null }, meta)).toEqual({ status: 'approved' });
  });

  it('rejecting a club frees the directory record; a claim can be turned down on approval', async () => {
    const a = await admin();
    const d = await directoryClub();
    const first = body({ directoryClubId: d.id });
    await register(first);
    const id1 = (await owner.query<{ id: string }>(`select club_id as id from club_users where email = $1`, [first.email])).rows[0]!.id;
    expect(await decideClub(a, id1, { action: 'reject', reason: 'Could not verify affiliation', affiliationExpiresOn: null }, meta)).toEqual({ status: 'rejected' });
    const second = body({ directoryClubId: d.id });
    expect((await register(second)).status).toBe(201);
    const id2 = (await owner.query<{ id: string }>(`select club_id as id from club_users where email = $1`, [second.email])).rows[0]!.id;
    expect(await decideClub(a, id2, { action: 'approve', reason: null, affiliationExpiresOn: null, rejectClaim: true }, meta)).toEqual({ status: 'approved' });
    expect((await owner.query(`select claim_status from directory_clubs where id = $1`, [d.id])).rows[0].claim_status).toBe('unclaimed');
  });

  it('only a signed-in administrator can decide; clubs cannot approve themselves', async () => {
    const c = await createClub({ status: 'submitted' });
    const b = body();
    const reg = await register(b);
    const clubCookie = cookieFrom(reg, 'rp_session')!;
    const call = (cookies?: Record<string, string>) => decideApi(req('POST', `/api/admin/clubs/${c.id}`, { cookies, body: { action: 'approve' } }), idCtx(c.id));
    expect((await call()).status).toBe(401);
    expect((await call({ rp_session: clubCookie })).status).toBe(401);
    expect((await call({ rp_admin: clubCookie })).status).toBe(401);
    expect((await owner.query(`select status from clubs where id = $1`, [c.id])).rows[0].status).toBe('submitted');
  });

  it('flags approved clubs whose affiliation date has passed', async () => {
    const c = await createClub();
    await owner.query(`update clubs set affiliation_expires_on = current_date - 1 where id = $1`, [c.id]);
    const res = await listClubsForAdmin({ filter: 'attention', q: c.name });
    expect(res.rows[0]).toMatchObject({ id: c.id, affiliationExpired: true });
  });
});
