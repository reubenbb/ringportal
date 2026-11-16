import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { searchMatches, matchQuerySchema, parseMatchQuery } from '@/server/matchmaking/service';
import { gate, score } from '@/lib/matchmaking';
import { closeDb } from '@/server/db/client';
import type { ClubSession } from '@/server/auth/session';
import { createBoxer, createClub, owner, yearsAgo } from './helpers';
import { TEST_APP_URL } from './test-config';

afterAll(async () => {
  await closeDb();
});

async function club(status = 'approved') {
  const c = await createClub({ status });
  const session: ClubSession = { sessionId: '', clubUserId: '00000000-0000-4000-8000-000000000000', clubId: c.id, email: '', clubName: c.name, clubSlug: c.slug, clubStatus: status as ClubSession['clubStatus'], isDemoClub: false };
  return { ...c, session };
}
const q = (o: Record<string, string> = {}) => matchQuerySchema.parse(o);

describe('matchmaking search', () => {
  it('applies gates before ranking and explains each suggestion', async () => {
    const a = await club();
    const b = await club();
    const pending = await club('submitted');
    // A distinctive weight keeps this test independent of other tests' boxers.
    const mine = await createBoxer(a.id, { dob: yearsAgo(24), weightKg: 91.3 });
    await owner.query(`update boxers set competitive_wins = 4, competitive_losses = 2 where id = $1`, [mine]);
    const close = await createBoxer(b.id, { firstName: 'Close', dob: yearsAgo(24), weightKg: 91.5 });
    await owner.query(`update boxers set competitive_wins = 3, competitive_losses = 2 where id = $1`, [close]);
    const further = await createBoxer(b.id, { firstName: 'Further', dob: yearsAgo(30), weightKg: 93 });
    await owner.query(`update boxers set competitive_wins = 14 where id = $1`, [further]);
    const tooHeavy = await createBoxer(b.id, { dob: yearsAgo(24), weightKg: 95 });
    const female = await createBoxer(b.id, { sex: 'female', dob: yearsAgo(24), weightKg: 91.3 });
    const junior = await createBoxer(b.id, { dob: yearsAgo(17), weightKg: 91.3 });
    const injured = await createBoxer(b.id, { dob: yearsAgo(24), weightKg: 91.3, availability: 'injured_medical' });
    const archived = await createBoxer(b.id, { dob: yearsAgo(24), weightKg: 91.3, archived: true });
    const ownOther = await createBoxer(a.id, { dob: yearsAgo(24), weightKg: 91.3 });
    const unapproved = await createBoxer(pending.id, { dob: yearsAgo(24), weightKg: 91.3 });

    const res = (await searchMatches(a.session, mine, q()))!;
    expect(res.suitable.map((r) => r.id)).toEqual([close, further]);
    expect(res.blocked).toEqual([]);
    const ids = new Set(res.suitable.map((r) => r.id));
    for (const excluded of [tooHeavy, female, junior, injured, archived, ownOther, unapproved, mine]) expect(ids.has(excluded)).toBe(false);
    expect(res.suitable[0]!.score).toBeGreaterThan(res.suitable[1]!.score);
    expect(res.suitable[0]!.factors.map((f) => f.key)).toEqual(['weight', 'age', 'experience', 'skills']);
    expect(res.suitable[1]!.flags).toContain('Experience gap of 8 competitive bouts');
    expect(JSON.stringify(res)).not.toMatch(/date_?of_?birth|dateOfBirth|medical/i);

    // Wider tolerance brings in the heavier boxer; unavailable boxers appear only when asked, and never as suitable.
    const wide = (await searchMatches(a.session, mine, q({ tol: '4', unavailable: '1' })))!;
    expect(wide.suitable.map((r) => r.id)).toContain(tooHeavy);
    expect(wide.blocked.map((r) => r.id)).toEqual([injured]);
    expect(wide.blocked[0]!.blocked).toEqual(['Not currently available']);
    // Experience filter and sorting are predictable.
    expect((await searchMatches(a.session, mine, q({ boutGap: '3' })))!.suitable.map((r) => r.id)).toEqual([close]);
    expect((await searchMatches(a.session, mine, q({ sort: 'weight' })))!.suitable.map((r) => r.id)).toEqual([close, further]);
  });

  it('filters by the opponent club’s region', async () => {
    const a = await club();
    const north = await club();
    const south = await club();
    const none = await club();
    await owner.query(`update clubs set region = 'Yorkshire' where id = $1`, [north.id]);
    await owner.query(`update clubs set region = 'London' where id = $1`, [south.id]);
    const mine = await createBoxer(a.id, { dob: yearsAgo(24), weightKg: 101.3 });
    const y = await createBoxer(north.id, { dob: yearsAgo(24), weightKg: 101.3 });
    const l = await createBoxer(south.id, { dob: yearsAgo(24), weightKg: 101.3 });
    const n = await createBoxer(none.id, { dob: yearsAgo(24), weightKg: 101.3 });
    const ids = async (o: Record<string, string>) => (await searchMatches(a.session, mine, q(o)))!.suitable.map((r) => r.id).sort();
    expect(await ids({})).toEqual([y, l, n].sort());
    expect(await ids({ region: 'Yorkshire' })).toEqual([y]);
    expect(await ids({ region: 'Nowhere' })).toEqual([]);
    const res = (await searchMatches(a.session, mine, q({ region: 'London' })))!;
    expect(res.suitable.map((r) => [r.id, r.clubRegion])).toEqual([[l, 'London']]);
    expect(res.filters.region).toBe('London');
  });

  it('keeps juniors with juniors and shortens their names', async () => {
    const a = await club();
    const b = await club();
    const mine = await createBoxer(a.id, { dob: yearsAgo(15), weightKg: 37.3 });
    const peer = await createBoxer(b.id, { firstName: 'Ellie', lastName: 'Morgan', dob: yearsAgo(16), weightKg: 37.3 });
    await createBoxer(b.id, { dob: yearsAgo(17), weightKg: 37.3 }); // outside default 1-year gap
    await createBoxer(b.id, { dob: yearsAgo(18), weightKg: 37.3 }); // adult
    const res = (await searchMatches(a.session, mine, q()))!;
    expect(res.suitable.map((r) => [r.id, r.displayName])).toEqual([[peer, 'Ellie M.']]);
    const wide = (await searchMatches(a.session, mine, q({ ageGap: '5' })))!;
    expect(wide.suitable.every((r) => r.isJunior)).toBe(true);
    expect(wide.filters.maxAge).toBe(17);
  });

  it('refuses boxers the club does not own, unapproved clubs and direct database access', async () => {
    const a = await club();
    const b = await club();
    const theirs = await createBoxer(b.id, { weightKg: 77.7 });
    expect(await searchMatches(a.session, theirs, q())).toBeNull();
    const pending = await club('submitted');
    const pendingBoxer = await createBoxer(pending.id, { weightKg: 77.7 });
    expect((await searchMatches(pending.session, pendingBoxer, q()))!.suitable).toEqual([]);
    const app = new Client({ connectionString: TEST_APP_URL });
    await app.connect();
    try {
      const call = `select * from match_candidates('male', 0, 300, 0, 120, null, true, null)`;
      expect((await app.query(call)).rowCount).toBe(0); // no context
      await app.query('begin');
      await app.query(`select set_config('app.context', 'auth', true)`);
      expect((await app.query(call)).rowCount).toBe(0);
      await app.query('rollback');
    } finally {
      await app.end();
    }
  });

  it('ignores invalid query values instead of failing', () => {
    expect(q({ boxer: 'x', tol: '999', sort: 'drop table', view: '<script>' })).toEqual({});
    // Blank form fields are 'not set', never zero.
    expect(parseMatchQuery({ ageGap: '', boutGap: ' ', tol: '', body: '', sort: ['weight', 'age'] })).toEqual({ sort: 'weight' });
  });

  it('a high score never overrides a gate', () => {
    const base = { sex: 'male' as const, ageYears: 17, isJunior: true, weightKg: 60, totalBouts: 3, skillsBouts: 1, availability: 'ready' };
    const adult = { ...base, ageYears: 18, isJunior: false };
    expect(score(base, adult, { toleranceKg: 2, ageGap: 1 }).total).toBeGreaterThan(80);
    expect(gate(base, adult)).toEqual(['One boxer is under 18 and the other is 18 or over']);
    expect(gate(base, { ...base, sex: 'female' })).toEqual(['Different sex category']);
    expect(gate(base, base)).toEqual([]);
  });
});
