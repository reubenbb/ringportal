import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as createApi } from '@/app/api/proposals/route';
import { POST as actionApi } from '@/app/api/proposals/[id]/route';
import { getProposal, listProposals } from '@/server/proposals/service';
import { notificationSummary } from '@/server/messaging/service';
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

const terms = { proposedDate: daysFromNow(30), weightKg: 63.5, boutType: 'competitive', travel: 'Away club travels', terms: '3 x 2 minute rounds' };

const create = (c: Club, body: Record<string, unknown>) => createApi(req('POST', '/api/proposals', { cookies: { rp_session: c.cookie }, body }), ctx);
const act = (c: Club, id: string, body: Record<string, unknown>) => actionApi(req('POST', `/api/proposals/${id}`, { cookies: { rp_session: c.cookie }, body }), idCtx(id));

async function scenario() {
  const a = await clubCtx();
  const b = await clubCtx();
  const aBoxer = await createBoxer(a.club.id, { firstName: 'Jack', lastName: 'Thompson', dob: yearsAgo(24), weightKg: 63.5 });
  const bBoxer = await createBoxer(b.club.id, { firstName: 'Ryan', lastName: 'Patel', dob: yearsAgo(25), weightKg: 64 });
  return { a, b, aBoxer, bBoxer };
}

async function propose(s: Awaited<ReturnType<typeof scenario>>, extra: Record<string, unknown> = {}) {
  const res = await create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: s.bBoxer, message: 'We are looking for a suitable competitive bout.', ...extra });
  expect(res.status).toBe(201);
  return (await json<{ id: string }>(res)).id;
}

describe('creating a bout proposal', () => {
  it('sends a proposal with version 1, an event, a linked conversation and an audit entry', async () => {
    const s = await scenario();
    const id = await propose(s);
    const viewA = await getProposal(s.a.session, id);
    expect(viewA).toMatchObject({ status: 'sent', currentVersion: 1, waitingOn: [s.b.club.id], actions: ['revise', 'withdraw'] });
    expect(viewA!.current).toMatchObject({ weightKg: 63.5, boutType: 'competitive', proposedDate: terms.proposedDate, authorClubId: s.a.club.id });
    expect(viewA!.conversationId).toBeTruthy();
    const viewB = await getProposal(s.b.session, id);
    expect(viewB!.actions).toEqual(['accept', 'revise', 'decline']);
    expect(viewB!.proposingClub.name).toBe(s.a.club.name);
    const { rows } = await owner.query(`select action, metadata from audit_log where target_id = $1`, [id]);
    expect(rows.map((r) => r.action)).toEqual(['proposal.created']);
    expect(JSON.stringify(rows[0].metadata)).not.toMatch(/suitable competitive bout/);
    expect((await notificationSummary(s.b.session)).proposalsNeedingAction).toBe(1);
    expect((await notificationSummary(s.a.session)).proposalsNeedingAction).toBe(0);
  });

  it('rejects boxers the club does not own, unavailable or mismatched boxers and invalid terms', async () => {
    const s = await scenario();
    // IDOR: proposing with the other club's boxer as "yours".
    let res = await create(s.a, { ...terms, proposingBoxerId: s.bBoxer, receivingBoxerId: s.aBoxer });
    expect(res.status).toBe(422);
    expect((await json<{ error: { fields: Record<string, string> } }>(res)).error.fields).toHaveProperty('proposingBoxerId');

    const injured = await createBoxer(s.b.club.id, { availability: 'injured_medical' });
    res = await create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: injured });
    expect((await json<{ error: { fields: Record<string, string> } }>(res)).error.fields).toHaveProperty('receivingBoxerId');

    const female = await createBoxer(s.b.club.id, { sex: 'female' });
    res = await create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: female });
    expect((await json<{ error: { fields: Record<string, string> } }>(res)).error.fields.proposingBoxerId).toMatch(/same sex/);

    // Safeguarding: junior v adult is refused in both directions, even when sex and weight match.
    const bJunior = await createBoxer(s.b.club.id, { dob: yearsAgo(15), weightKg: 63.5 });
    res = await create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: bJunior });
    expect(res.status).toBe(422);
    expect((await json<{ error: { fields: Record<string, string> } }>(res)).error.fields.proposingBoxerId).toMatch(/under-18s/i);
    const aJunior = await createBoxer(s.a.club.id, { dob: yearsAgo(16), weightKg: 64 });
    res = await create(s.a, { ...terms, proposingBoxerId: aJunior, receivingBoxerId: s.bBoxer });
    expect(res.status).toBe(422);
    expect((await json<{ error: { fields: Record<string, string> } }>(res)).error.fields.proposingBoxerId).toMatch(/under-18s/i);
    // Junior v junior is still allowed.
    res = await create(s.a, { ...terms, proposingBoxerId: aJunior, receivingBoxerId: bJunior });
    expect(res.status).toBe(201);

    const archived = await createBoxer(s.b.club.id, { archived: true });
    res = await create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: archived });
    expect(res.status).toBe(422);

    const pending = await clubCtx('submitted');
    const pendingBoxer = await createBoxer(pending.club.id);
    res = await create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: pendingBoxer });
    expect(res.status).toBe(422);

    res = await create(s.a, { ...terms, proposedDate: '2020-01-01', weightKg: 300, boutType: 'exhibition', proposingBoxerId: s.aBoxer, receivingBoxerId: s.bBoxer });
    expect(res.status).toBe(422);
    expect(Object.keys((await json<{ error: { fields: Record<string, string> } }>(res)).error.fields).sort()).toEqual(['boutType', 'proposedDate', 'weightKg']);

    // Mass assignment: status, version or clubs in the body are ignored.
    const id = (await json<{ id: string }>(await create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: s.bBoxer, status: 'confirmed', currentVersion: 9, proposingClubId: s.b.club.id }))).id;
    expect(await getProposal(s.a.session, id)).toMatchObject({ status: 'sent', currentVersion: 1, proposingClub: { id: s.a.club.id } });
  });

  it('allows only one open proposal per pair of boxers, in either direction, even under concurrency', async () => {
    const s = await scenario();
    const results = await Promise.all([
      create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: s.bBoxer }),
      create(s.a, { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: s.bBoxer }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const reverse = await create(s.b, { ...terms, proposingBoxerId: s.bBoxer, receivingBoxerId: s.aBoxer });
    expect(reverse.status).toBe(409);
  });

  it('requires an authenticated, approved club and a same-origin request', async () => {
    const s = await scenario();
    const body = { ...terms, proposingBoxerId: s.aBoxer, receivingBoxerId: s.bBoxer };
    expect((await createApi(req('POST', '/api/proposals', { body }), ctx)).status).toBe(401);
    const pending = await clubCtx('submitted');
    expect((await create(pending, body)).status).toBe(403);
    expect((await createApi(req('POST', '/api/proposals', { cookies: { rp_session: s.a.cookie }, body, origin: 'https://evil.example' }), ctx)).status).toBe(403);
  });
});

describe('negotiation, versions and dual final confirmation', () => {
  let s: Awaited<ReturnType<typeof scenario>>;
  let id: string;
  beforeEach(async () => {
    s = await scenario();
    id = await propose(s);
  });

  it('runs the full two-club flow; a revision resets acceptance and both confirmations', async () => {
    // Club B accepts version 1 in principle; this is not a confirmed bout.
    expect(await json(await act(s.b, id, { action: 'accept', expectedVersion: 1 }))).toEqual({ status: 'accepted_in_principle', version: 1 });
    let view = await getProposal(s.a.session, id);
    expect(view!.waitingOn.sort()).toEqual([s.a.club.id, s.b.club.id].sort());
    expect(view!.actions).toEqual(['confirm', 'revise', 'withdraw']);

    // Club A gives final confirmation of v1; still awaiting B.
    expect(await json(await act(s.a, id, { action: 'confirm', expectedVersion: 1 }))).toEqual({ status: 'awaiting_confirmation', version: 1 });
    view = await getProposal(s.b.session, id);
    expect(view!.confirmations.map((c) => c.clubId)).toEqual([s.a.club.id]);
    expect(view!.waitingOn).toEqual([s.b.club.id]);

    // Club B changes the weight instead: new version, A's confirmation no longer counts.
    const revised = await act(s.b, id, { action: 'revise', expectedVersion: 1, terms: { ...terms, weightKg: 64 }, message: 'Can we do 64 kg?' });
    expect(await json(revised)).toEqual({ status: 'negotiating', version: 2 });
    view = await getProposal(s.a.session, id);
    expect(view).toMatchObject({ status: 'negotiating', currentVersion: 2, confirmations: [], waitingOn: [s.a.club.id] });
    expect(view!.versions.map((v) => [v.version, v.weightKg, v.authorClubId])).toEqual([
      [1, 63.5, s.a.club.id],
      [2, 64, s.b.club.id],
    ]);
    expect(view!.versions[1]!.changed).toEqual(['weightKg']);

    // A cannot act on the stale version.
    expect((await act(s.a, id, { action: 'accept', expectedVersion: 1 })).status).toBe(409);
    // B cannot accept its own version.
    expect((await act(s.b, id, { action: 'accept', expectedVersion: 2 })).status).toBe(409);

    // A accepts v2, then both clubs confirm v2: only now is it a confirmed bout.
    expect((await json(await act(s.a, id, { action: 'accept', expectedVersion: 2 }))).status).toBe('accepted_in_principle');
    expect((await json(await act(s.b, id, { action: 'confirm', expectedVersion: 2 }))).status).toBe('awaiting_confirmation');
    expect((await act(s.b, id, { action: 'confirm', expectedVersion: 2 })).status).toBe(409); // already confirmed
    expect((await json(await act(s.a, id, { action: 'confirm', expectedVersion: 2 }))).status).toBe('confirmed');

    view = await getProposal(s.b.session, id);
    expect(view).toMatchObject({ status: 'confirmed', waitingOn: [], actions: ['revise', 'withdraw'] });
    expect(view!.confirmations).toHaveLength(2);
    expect(view!.events.map((e) => e.event)).toEqual(['created', 'accepted', 'confirmed', 'revised', 'accepted', 'confirmed', 'confirmed', 'bout_confirmed']);

    // Changing a material term after confirmation resets both confirmations.
    expect(await json(await act(s.a, id, { action: 'revise', expectedVersion: 2, terms: { ...terms, weightKg: 64, proposedDate: daysFromNow(37) } }))).toEqual({ status: 'negotiating', version: 3 });
    view = await getProposal(s.a.session, id);
    expect(view).toMatchObject({ status: 'negotiating', confirmations: [], waitingOn: [s.b.club.id] });
    expect(view!.versions[2]!.changed).toEqual(['proposedDate']);

    const { rows } = await owner.query(`select action from audit_log where target_id = $1 order by id`, [id]);
    expect(rows.map((r) => r.action)).toEqual([
      'proposal.created', 'proposal.accept', 'proposal.confirm', 'proposal.revise', 'proposal.accept', 'proposal.confirm', 'proposal.confirm', 'proposal.revise',
    ]);
  });

  it('serialises simultaneous final confirmations so the bout is confirmed exactly once', async () => {
    await act(s.b, id, { action: 'accept', expectedVersion: 1 });
    const [ra, rb] = await Promise.all([act(s.a, id, { action: 'confirm', expectedVersion: 1 }), act(s.b, id, { action: 'confirm', expectedVersion: 1 })]);
    const statuses = [(await json<{ status: string }>(ra)).status, (await json<{ status: string }>(rb)).status].sort();
    expect(statuses).toEqual(['awaiting_confirmation', 'confirmed']);
    const { rows } = await owner.query(`select count(*)::int as n from bout_proposal_events where proposal_id = $1 and event = 'bout_confirmed'`, [id]);
    expect(rows[0].n).toBe(1);
  });

  it('rejects a revision that changes nothing, and actions not open to that club', async () => {
    expect((await act(s.b, id, { action: 'revise', expectedVersion: 1, terms })).status).toBe(422);
    expect((await act(s.b, id, { action: 'confirm', expectedVersion: 1 })).status).toBe(409); // not accepted yet
    expect((await act(s.b, id, { action: 'withdraw' })).status).toBe(409); // receiver declines rather than withdraws
    expect((await act(s.a, id, { action: 'decline', expectedVersion: 1 })).status).toBe(409); // proposer withdraws rather than declines
    expect((await act(s.a, id, { action: 'delete' })).status).toBe(422);
  });

  it('decline closes the proposal; a new proposal between the same boxers is then allowed', async () => {
    expect((await json(await act(s.b, id, { action: 'decline', expectedVersion: 1, message: 'Not this time, thanks.' }))).status).toBe('declined');
    for (const action of ['accept', 'confirm', 'decline']) {
      expect((await act(s.b, id, { action, expectedVersion: 1 })).status).toBe(409);
    }
    expect((await act(s.a, id, { action: 'withdraw' })).status).toBe(409);
    await propose(s);
  });

  it('withdraw closes the proposal for both clubs', async () => {
    expect((await json(await act(s.a, id, { action: 'withdraw', message: 'Our boxer is unavailable.' }))).status).toBe('withdrawn');
    expect((await getProposal(s.b.session, id))!.actions).toEqual([]);
  });
});

describe('proposal privacy and isolation', () => {
  it('a third club cannot see or act on a proposal; IDs are not enumerable', async () => {
    const s = await scenario();
    const id = await propose(s);
    const c = await clubCtx();
    expect(await getProposal(c.session, id)).toBeNull();
    expect((await act(c, id, { action: 'accept', expectedVersion: 1 })).status).toBe(404);
    expect((await act(c, id, { action: 'withdraw' })).status).toBe(404);
    expect((await act(c, 'not-a-uuid', { action: 'withdraw' })).status).toBe(404);
    expect((await listProposals(c.session, 'open')).items).toHaveLength(0);
  });

  it('lists each club only its own proposals, with filters and keyset pagination', async () => {
    const s = await scenario();
    const ids: string[] = [];
    for (let i = 0; i < 27; i++) {
      const bBoxer = await createBoxer(s.b.club.id, { weightKg: 60 + (i % 5) });
      ids.push(await propose({ ...s, bBoxer }));
    }
    const page1 = await listProposals(s.b.session, 'action');
    expect(page1.items).toHaveLength(25);
    expect(page1.items.every((p) => p.needsMyAction && !p.iProposed && p.otherClub.id === s.a.club.id)).toBe(true);
    const page2 = await listProposals(s.b.session, 'action', page1.nextCursor);
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((p) => p.id))).toEqual(new Set(ids));
    expect((await listProposals(s.a.session, 'action')).items).toHaveLength(0);
    expect((await listProposals(s.a.session, 'open')).items).toHaveLength(25);
    expect((await listProposals(s.b.session, 'open', 'garbage|cursor')).items).toHaveLength(25);
  });

  it('shows the other club a junior only by first name and surname initial; no DOB anywhere', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const aJunior = await createBoxer(a.club.id, { firstName: 'Lewis', lastName: 'Carter', dob: yearsAgo(15), weightKg: 48 });
    const bJunior = await createBoxer(b.club.id, { firstName: 'Ellie', lastName: 'Morgan', dob: yearsAgo(15), weightKg: 48 });
    const res = await create(a, { ...terms, weightKg: 48, proposingBoxerId: aJunior, receivingBoxerId: bJunior });
    const { id } = await json<{ id: string }>(res);
    const forA = await getProposal(a.session, id);
    expect(forA!.proposingBoxer!.displayName).toBe('Lewis Carter');
    expect(forA!.receivingBoxer!.displayName).toBe('Ellie M.');
    const forB = await getProposal(b.session, id);
    expect(forB!.proposingBoxer!.displayName).toBe('Lewis C.');
    expect(JSON.stringify(forB)).not.toMatch(/Carter|date_?of_?birth|dateOfBirth/i);
  });

  it('database policies hold even if the application layer is bypassed', async () => {
    const s = await scenario();
    const id = await propose(s);
    const c = await clubCtx();
    const app = new Client({ connectionString: TEST_APP_URL });
    await app.connect();
    try {
      const as = async (clubId: string) => {
        await app.query('begin');
        await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [clubId]);
      };
      await as(c.club.id);
      for (const t of ['bout_proposals', 'bout_proposal_versions', 'bout_proposal_confirmations', 'bout_proposal_events', 'conversations', 'messages']) {
        const { rows } = await app.query(`select count(*)::int as n from ${t}`);
        expect(rows[0].n, t).toBe(0);
      }
      expect((await app.query(`update bout_proposals set status = 'confirmed' where id = $1`, [id])).rowCount).toBe(0);
      await expect(app.query(`insert into bout_proposal_confirmations (proposal_id, version, club_id) values ($1, 1, $2)`, [id, c.club.id])).rejects.toThrow(/row-level security/);
      await app.query('rollback');

      // A party cannot forge the other club's confirmation, rewrite history, or swap boxers.
      await as(s.a.club.id);
      await expect(app.query(`insert into bout_proposal_confirmations (proposal_id, version, club_id) values ($1, 1, $2)`, [id, s.b.club.id])).rejects.toThrow(/row-level security/);
      await app.query('rollback');
      await as(s.a.club.id);
      await expect(app.query(`update bout_proposal_versions set weight_kg = 70 where proposal_id = $1`, [id])).rejects.toThrow(/permission denied/);
      await app.query('rollback');
      await as(s.a.club.id);
      await expect(app.query(`delete from bout_proposals where id = $1`, [id])).rejects.toThrow(/permission denied/);
      await app.query('rollback');
      await as(s.a.club.id);
      const other = await createBoxer(s.b.club.id);
      await expect(app.query(`update bout_proposals set receiving_boxer_id = $2 where id = $1`, [id, other])).rejects.toThrow(/cannot be changed/);
      await app.query('rollback');
    } finally {
      await app.end();
    }
  });
});
