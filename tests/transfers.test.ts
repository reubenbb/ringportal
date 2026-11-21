import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as requestApi } from '@/app/api/transfers/route';
import { POST as actApi } from '@/app/api/transfers/[id]/route';
import { POST as blockApi } from '@/app/api/clubs/[id]/block/route';
import { POST as availabilityApi } from '@/app/api/boxers/[id]/availability/route';
import { POST as proposeApi } from '@/app/api/proposals/route';
import { countIncomingPendingTransfers, listTransfers, pendingOutgoingFor } from '@/server/transfers/service';
import { closeDb } from '@/server/db/client';
import type { ClubSession } from '@/server/auth/session';
import { PASSWORD, cookieFrom, createBoxer, createClubWithUser, ctx, idCtx, json, owner, req, yearsAgo } from './helpers';
import { TEST_APP_URL } from './test-config';

afterAll(async () => {
  await closeDb();
});

type Club = Awaited<ReturnType<typeof clubCtx>>;
async function clubCtx(status = 'approved') {
  const { club, user } = await createClubWithUser({ status });
  const res = await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx);
  const cookie = cookieFrom(res, 'rp_session')!;
  const session: ClubSession = { sessionId: '', clubUserId: user.id, clubId: club.id, email: user.email, clubName: club.name, clubSlug: club.slug, clubStatus: status as ClubSession['clubStatus'], isDemoClub: false };
  return { club, user, cookie, session };
}
const call = (handler: (r: never, c: never) => Promise<Response>, c: Club, path: string, body: unknown, id?: string) =>
  handler(req('POST', path, { cookies: { rp_session: c.cookie }, body }) as never, (id ? idCtx(id) : ctx) as never);
const ask = (c: Club, boxerId: string, note?: string) => call(requestApi, c, '/api/transfers', { boxerId, note });
const act = (c: Club, id: string, action: string) => call(actApi, c, `/api/transfers/${id}`, { action }, id);
const errMsg = async (res: Response) => (await json<{ error: { message: string } }>(res)).error.message;

async function boxerRow(id: string) {
  const { rows } = await owner.query(
    `select b.club_id, b.availability, p.club_id as private_club, p.notes, p.guardian_consent_at, p.date_of_birth::text as dob
     from boxers b join boxer_private p on p.boxer_id = b.id where b.id = $1`,
    [id],
  );
  return rows[0];
}

describe('boxer transfers', () => {
  it('new club requests, current club approves: boxer and private record move, notes and consent do not', async () => {
    const from = await clubCtx();
    const to = await clubCtx();
    const boxer = await createBoxer(from.club.id, { dob: yearsAgo(16), weightKg: 57 });
    await owner.query(`update boxer_private set notes = 'internal note', medical_status = 'cleared', guardian_consent_at = now() where boxer_id = $1`, [boxer]);

    const res = await ask(to, boxer, 'Moving to our area in January');
    expect(res.status).toBe(200);
    const { id } = await json<{ id: string }>(res);

    expect(await countIncomingPendingTransfers(from.session)).toBe(1);
    expect(await countIncomingPendingTransfers(to.session)).toBe(0);
    expect([...(await pendingOutgoingFor(to.session, [boxer]))]).toEqual([boxer]);
    const incoming = (await listTransfers(from.session))[0]!;
    expect(incoming).toMatchObject({ id, direction: 'incoming', status: 'pending', note: 'Moving to our area in January' });
    expect(incoming.otherClub?.id).toBe(to.club.id);
    const outgoing = (await listTransfers(to.session))[0]!;
    expect(outgoing).toMatchObject({ id, direction: 'outgoing', status: 'pending' });
    expect(outgoing.boxerName).toMatch(/^Test B\.$/); // junior name stays minimised for the requesting club

    // Only the current club can decide; only the requesting club can cancel.
    expect((await act(to, id, 'approve')).status).toBe(404);
    expect((await act(from, id, 'cancel')).status).toBe(404);

    expect((await act(from, id, 'approve')).status).toBe(200);
    const after = await boxerRow(boxer);
    expect(after).toMatchObject({ club_id: to.club.id, private_club: to.club.id, availability: 'inactive', notes: null, guardian_consent_at: null });
    expect((await owner.query(`select medical_status from boxer_private where boxer_id = $1`, [boxer])).rows[0].medical_status).toBe('cleared');
    expect((await act(from, id, 'approve')).status).toBe(409);
    expect((await listTransfers(to.session))[0]!.status).toBe('approved');

    // The junior cannot be made available until the new club records consent.
    const avail = await call(availabilityApi, to, `/api/boxers/${boxer}/availability`, { status: 'ready' }, boxer);
    expect(avail.status).toBe(409);
    expect(await errMsg(avail)).toMatch(/guardian consent/);
    // The old club no longer controls the boxer.
    expect((await call(availabilityApi, from, `/api/boxers/${boxer}/availability`, { status: 'ready' }, boxer)).status).toBe(404);

    const audit = await owner.query(`select action, club_id from audit_log where target_id = $1 order by id`, [id]);
    expect(audit.rows).toEqual([
      { action: 'transfer.requested', club_id: to.club.id },
      { action: 'transfer.approved', club_id: from.club.id },
    ]);
  });

  it('decline and cancel; one pending request per boxer; own, unknown, archived and unapproved cases', async () => {
    const from = await clubCtx();
    const to = await clubCtx();
    const third = await clubCtx();
    const pending = await clubCtx('under_review');
    const boxer = await createBoxer(from.club.id);
    const archived = await createBoxer(from.club.id, { archived: true });

    const { id } = await json<{ id: string }>(await ask(to, boxer));
    const dup = await ask(third, boxer);
    expect(dup.status).toBe(409);
    expect(await errMsg(dup)).toMatch(/already waiting/);
    expect((await act(from, id, 'decline')).status).toBe(200);
    expect((await boxerRow(boxer)).club_id).toBe(from.club.id);

    const again = await json<{ id: string }>(await ask(to, boxer));
    expect((await act(to, again.id, 'cancel')).status).toBe(200);
    expect((await act(from, again.id, 'approve')).status).toBe(409);

    expect((await ask(from, boxer)).status).toBe(409); // own boxer
    expect((await ask(to, archived)).status).toBe(404);
    expect((await ask(to, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await ask(pending, boxer)).status).toBe(403); // unapproved clubs are stopped by the API guard
    expect((await ask(to, boxer, 'x'.repeat(501))).status).toBe(422);
  });

  it('cannot be approved while the boxer has an open proposal or a confirmed bout', async () => {
    const from = await clubCtx();
    const to = await clubCtx();
    const other = await clubCtx();
    const boxer = await createBoxer(from.club.id, { dob: yearsAgo(25), weightKg: 70 });
    const opp = await createBoxer(other.club.id, { dob: yearsAgo(25), weightKg: 70 });
    const prop = await call(proposeApi, from, '/api/proposals', { proposingBoxerId: boxer, receivingBoxerId: opp, weightKg: 70, boutType: 'competitive' });
    expect(prop.status).toBe(201);
    const { id } = await json<{ id: string }>(await ask(to, boxer));
    const res = await act(from, id, 'approve');
    expect(res.status).toBe(409);
    expect(await errMsg(res)).toMatch(/open bout proposal/);

    await owner.query(`update bout_proposals set status = 'withdrawn' where proposing_boxer_id = $1`, [boxer]);
    await owner.query(`update boxers set availability = 'confirmed' where id = $1`, [boxer]);
    expect(await errMsg(await act(from, id, 'approve'))).toMatch(/confirmed bout/);
    await owner.query(`update boxers set availability = 'ready' where id = $1`, [boxer]);
    expect((await act(from, id, 'approve')).status).toBe(200);
  });

  it('open or arranged sparring blocks approval; a finished session does not', async () => {
    const from = await clubCtx();
    const to = await clubCtx();
    const other = await clubCtx();
    const partner = await createBoxer(from.club.id);
    const theirs = await createBoxer(other.club.id);
    const { rows } = await owner.query(`insert into sparring_requests (club_id, boxer_id, status) values ($1, $2, 'arranged') returning id`, [other.club.id, theirs]);
    await owner.query(
      `insert into sparring_offers (request_id, request_club_id, offering_club_id, partner_boxer_id, status) values ($1, $2, $3, $4, 'approved')`,
      [rows[0].id, other.club.id, from.club.id, partner],
    );
    const { id } = await json<{ id: string }>(await ask(to, partner));
    expect(await errMsg(await act(from, id, 'approve'))).toMatch(/sparring/);
    await owner.query(`update sparring_requests set status = 'closed' where id = $1`, [rows[0].id]);
    expect((await act(from, id, 'approve')).status).toBe(200);
  });

  it('blocks stop requests and approvals both ways', async () => {
    const from = await clubCtx();
    const to = await clubCtx();
    const boxer = await createBoxer(from.club.id);
    const { id } = await json<{ id: string }>(await ask(to, boxer));
    expect((await call(blockApi, to, `/api/clubs/${from.club.id}/block`, { blocked: true }, from.club.id)).status).toBe(200);
    expect((await act(from, id, 'approve')).status).toBe(409);
    expect((await act(to, id, 'cancel')).status).toBe(200);
    expect((await ask(to, boxer)).status).toBe(409);
  });

  it('database: clubs cannot write transfers or move boxers directly, see only their own transfers, and cannot spoof a user', async () => {
    const from = await clubCtx();
    const to = await clubCtx();
    const stranger = await clubCtx();
    const boxer = await createBoxer(from.club.id);
    const { id } = await json<{ id: string }>(await ask(to, boxer));

    const app = new Client({ connectionString: TEST_APP_URL });
    await app.connect();
    const asClub = async (clubId: string, q: string, params: unknown[] = []) => {
      await app.query('begin');
      try {
        await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [clubId]);
        return await app.query(q, params);
      } finally {
        await app.query('rollback');
      }
    };
    try {
      expect((await asClub(stranger.club.id, `select id from boxer_transfers`)).rowCount).toBe(0);
      expect((await asClub(from.club.id, `select id from boxer_transfers where id = $1`, [id])).rowCount).toBe(1);
      await expect(asClub(from.club.id, `update boxer_transfers set status = 'approved' where id = $1`, [id])).rejects.toThrow(/permission denied/);
      await expect(
        asClub(to.club.id, `insert into boxer_transfers (boxer_id, from_club_id, to_club_id) values ($1, $2, $3)`, [boxer, from.club.id, to.club.id]),
      ).rejects.toThrow(/permission denied/);
      // The owning club still cannot write the boxer into another club.
      await expect(asClub(from.club.id, `update boxers set club_id = $2 where id = $1`, [boxer, to.club.id])).rejects.toThrow(/row-level security/);
      // A stranger cannot decide, and cannot act as another club's user.
      expect((await asClub(stranger.club.id, `select decide_boxer_transfer($1, $2, true) as r`, [id, stranger.user.id])).rows[0].r).toBe('not_found');
      await expect(asClub(stranger.club.id, `select decide_boxer_transfer($1, $2, true)`, [id, from.user.id])).rejects.toThrow(/does not belong/);
      await expect(asClub(from.club.id, `select app_assert_club_user($1)`, [from.user.id])).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
    expect((await boxerRow(boxer)).club_id).toBe(from.club.id);
  });
});
