import { afterAll, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as adminLogin } from '@/app/api/admin/auth/login/route';
import { POST as createBoxerApi } from '@/app/api/boxers/route';
import { PUT as updateBoxerApi } from '@/app/api/boxers/[id]/route';
import { POST as claimApi } from '@/app/api/club/claim/route';
import { POST as createAdminApi } from '@/app/api/admin/users/route';
import { POST as proposeApi } from '@/app/api/proposals/route';
import { actOnAdminUser, createAdminUser, listAdminUsers } from '@/server/admin/users';
import { decideClaim, getClubForAdmin, listClubsForAdmin } from '@/server/clubs/admin';
import { getClubOverview } from '@/server/club/queries';
import { closeDb } from '@/server/db/client';
import type { AdminSession, ClubSession } from '@/server/auth/session';
import { PASSWORD, cookieFrom, createBoxer, createClubWithUser, createPlatformUser, ctx, idCtx, json, owner, req, uid, yearsAgo } from './helpers';

afterAll(async () => {
  await closeDb();
});

async function clubCtx(status = 'approved') {
  const { club, user } = await createClubWithUser({ status });
  const cookie = cookieFrom(await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
  const session: ClubSession = { sessionId: '', clubUserId: user.id, clubId: club.id, email: user.email, clubName: club.name, clubSlug: club.slug, clubStatus: status as ClubSession['clubStatus'], isDemoClub: false };
  return { club, user, cookie, session };
}
async function adminSession(role: 'owner' | 'admin' = 'admin'): Promise<AdminSession> {
  const u = await createPlatformUser({ role });
  return { sessionId: '', platformUserId: u.id, email: u.email, displayName: 'Test Admin', role };
}
const meta = { ipHash: 't' };
const boxer = (o: Record<string, unknown> = {}) => ({ firstName: 'Lewis', lastName: 'Carter', sex: 'male', dateOfBirth: yearsAgo(15), weightKg: 48, competitiveWins: 0, competitiveLosses: 0, competitiveDraws: 0, skillsBouts: 2, ...o });

describe('guardian consent for under-18 boxers', () => {
  it('is required to add a junior, recorded with who confirmed it, and not needed for adults', async () => {
    const a = await clubCtx();
    const add = (b: Record<string, unknown>) => createBoxerApi(req('POST', '/api/boxers', { cookies: { rp_session: a.cookie }, body: b }), ctx);
    const refused = await add(boxer());
    expect(refused.status).toBe(422);
    expect((await json<{ error: { fields: Record<string, string> } }>(refused)).error.fields).toHaveProperty('guardianConsent');
    const { id } = await json<{ id: string }>(await add(boxer({ guardianConsent: 'on' })));
    const row = (await owner.query(`select guardian_consent_at, guardian_consent_by from boxer_private where boxer_id = $1`, [id])).rows[0];
    expect(row.guardian_consent_at).toBeTruthy();
    expect(row.guardian_consent_by).toBe(a.user.id);
    expect((await add(boxer({ dateOfBirth: yearsAgo(25) }))).status).toBe(201);

    // A junior added before consent was recorded cannot be saved again without it.
    const old = await createBoxer(a.club.id, { dob: yearsAgo(14) });
    const save = (b: Record<string, unknown>) => updateBoxerApi(req('PUT', `/api/boxers/${old}`, { cookies: { rp_session: a.cookie }, body: b }), idCtx(old));
    expect((await save(boxer({ dateOfBirth: yearsAgo(14) }))).status).toBe(422);
    expect((await save(boxer({ dateOfBirth: yearsAgo(14), guardianConsent: true }))).status).toBe(200);
    expect((await save(boxer({ dateOfBirth: yearsAgo(14), weightKg: 49 }))).status).toBe(200);
  });
});

describe('claiming a directory record after registration', () => {
  it('a registered club requests a claim; an admin approves it and the region follows', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const d = (await owner.query<{ id: string }>(`insert into directory_clubs (source, source_ref, source_url, name, slug, governing_body_id, region) values ('england_boxing_directory', $1, 'https://example.test/d', $2, $3, 1, 'Yorkshire') returning id`, [`ref-${uid()}`, `Claimable ${uid()}`, `dir-${uid()}`])).rows[0]!.id;
    const claim = (cookie: string | null, id = d) => claimApi(req('POST', '/api/club/claim', { cookies: cookie ? { rp_session: cookie } : undefined, body: { directoryClubId: id } }), ctx);
    expect((await claim(null)).status).toBe(401);
    const demo = await clubCtx();
    await owner.query(`update clubs set is_demo = true where id = $1`, [demo.club.id]);
    expect((await claim(demo.cookie)).status).toBe(409); // demo clubs can never claim a real record
    expect((await claim(a.cookie)).status).toBe(201);
    expect((await claim(a.cookie)).status).toBe(409); // one claim per club
    expect((await claim(b.cookie)).status).toBe(409); // record already has a pending claim
    expect((await getClubOverview(a.session))!.claim).toMatchObject({ status: 'pending' });
    expect((await owner.query(`select claim_status from directory_clubs where id = $1`, [d])).rows[0].claim_status).toBe('unclaimed');
    expect((await listClubsForAdmin({ filter: 'review', q: a.club.name })).rows.map((r) => r.id)).toEqual([a.club.id]);

    const admin = await adminSession();
    const claimId = (await getClubForAdmin(a.club.id))!.claims[0]!.id;
    await decideClaim(admin, claimId, true, meta);
    await expect(decideClaim(admin, claimId, false, meta)).rejects.toMatchObject({ code: 'conflict' });
    expect((await owner.query(`select claim_status, club_id from directory_clubs where id = $1`, [d])).rows[0]).toEqual({ claim_status: 'claimed', club_id: a.club.id });
    expect((await getClubOverview(a.session))!).toMatchObject({ region: 'Yorkshire', claim: { status: 'approved' } });
    expect((await owner.query(`select 1 from audit_log where action = 'club.claim_approved' and target_id = $1 and actor_id = $2`, [a.club.id, admin.platformUserId])).rowCount).toBe(1);
  });
});

describe('admin view of a club’s proposals', () => {
  it('lists proposals with current terms and minimised boxer names', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const mine = await createBoxer(a.club.id, { firstName: 'Tom', lastName: 'Walker', dob: yearsAgo(15), weightKg: 50 });
    const theirs = await createBoxer(b.club.id, { firstName: 'Sam', lastName: 'Reid', dob: yearsAgo(15), weightKg: 50 });
    await proposeApi(req('POST', '/api/proposals', { cookies: { rp_session: a.cookie }, body: { proposingBoxerId: mine, receivingBoxerId: theirs, weightKg: 50, boutType: 'skills' } }), ctx);
    const detail = (await getClubForAdmin(a.club.id))!;
    expect(detail.proposals).toHaveLength(1);
    expect(detail.proposals[0]).toMatchObject({ status: 'sent', otherClub: b.club.name, boxers: 'Tom W. v Sam R.', weightKg: 50 });
  });
});

describe('administrator accounts', () => {
  it('only an owner can create, disable, enable and reset; one-time password works and is never logged', async () => {
    const own = await adminSession('owner');
    const plain = await adminSession('admin');
    await expect(listAdminUsers(plain)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createAdminUser(plain, { email: `x-${uid()}@example.test`, displayName: 'Nope', role: 'owner' }, meta)).rejects.toMatchObject({ code: 'forbidden' });
    expect((await createAdminApi(req('POST', '/api/admin/users', { body: { email: `y-${uid()}@example.test`, displayName: 'No Session', role: 'admin' } }), ctx)).status).toBe(401);

    const email = `new-admin-${uid()}@example.test`;
    const created = await createAdminUser(own, { email, displayName: 'New Admin', role: 'admin' }, meta);
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(20);
    await expect(createAdminUser(own, { email, displayName: 'Dupe', role: 'admin' }, meta)).rejects.toMatchObject({ code: 'validation_failed' });
    const audit = await owner.query(`select metadata from audit_log where action = 'admin.account_created' and target_id = $1`, [created.id]);
    expect(JSON.stringify(audit.rows)).not.toContain(created.temporaryPassword);
    // The one-time password signs in, and two-factor setup is the forced next step.
    const res = await adminLogin(req('POST', '/api/admin/auth/login', { body: { email, password: created.temporaryPassword } }), ctx);
    expect(res.status).toBe(200);
    expect((await json<{ next: string }>(res)).next).toMatch(/enrol/);

    expect((await listAdminUsers(own)).find((u) => u.id === created.id)).toMatchObject({ status: 'active', mfaEnabled: false, isYou: false });
    await expect(actOnAdminUser(own, own.platformUserId, { action: 'disable', reason: 'Locking myself out' }, meta)).rejects.toMatchObject({ code: 'conflict' });
    await actOnAdminUser(own, created.id, { action: 'disable', reason: 'Left the team' }, meta);
    expect((await adminLogin(req('POST', '/api/admin/auth/login', { body: { email, password: created.temporaryPassword } }), ctx)).status).toBe(401);
    await actOnAdminUser(own, created.id, { action: 'enable', reason: 'Rejoined the team' }, meta);
    await actOnAdminUser(own, plain.platformUserId, { action: 'reset_mfa', reason: 'Lost their phone' }, meta);
    expect((await owner.query(`select mfa_enabled_at from platform_users where id = $1`, [plain.platformUserId])).rows[0].mfa_enabled_at).toBeNull();

    // An owner can disable another owner while at least one other active owner remains.
    const second = await adminSession('owner');
    await actOnAdminUser(own, second.platformUserId, { action: 'disable', reason: 'Handing over' }, meta);
    expect((await owner.query(`select status from platform_users where id = $1`, [second.platformUserId])).rows[0].status).toBe('disabled');
  });

  it('never leaves the platform without an active owner, even when two owners disable each other at once', async () => {
    const a = await adminSession('owner');
    const b = await adminSession('owner');
    // Test files run one at a time: make a and b the only active owners for this test, then restore.
    const { rows: parked } = await owner.query(
      `update platform_users set status = 'disabled' where role = 'owner' and status = 'active' and id not in ($1, $2) returning id`,
      [a.platformUserId, b.platformUserId],
    );
    try {
      const results = await Promise.allSettled([
        actOnAdminUser(a, b.platformUserId, { action: 'disable', reason: 'Race test one' }, meta),
        actOnAdminUser(b, a.platformUserId, { action: 'disable', reason: 'Race test two' }, meta),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'conflict', message: 'This is the only active owner account.' });
      const active = await owner.query(`select id from platform_users where role = 'owner' and status = 'active' and id in ($1, $2)`, [a.platformUserId, b.platformUserId]);
      expect(active.rowCount).toBe(1);
      // A stale session of the disabled owner still cannot disable the last active one.
      const survivor = active.rows[0].id as string;
      const stale = survivor === a.platformUserId ? b : a;
      await expect(actOnAdminUser(stale, survivor, { action: 'disable', reason: 'Stale session try' }, meta)).rejects.toMatchObject({ code: 'conflict' });
    } finally {
      if (parked.length) await owner.query(`update platform_users set status = 'active' where id = any($1::uuid[])`, [parked.map((r) => r.id)]);
    }
  });
});
