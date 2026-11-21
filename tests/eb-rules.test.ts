import { afterAll, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as proposeApi } from '@/app/api/proposals/route';
import { POST as createSparApi } from '@/app/api/sparring/route';
import { searchMatches, matchQuerySchema } from '@/server/matchmaking/service';
import { competitiveCheck, skillsCheck, type PairFacts } from '@/lib/eb-rules';
import { closeDb, withClub } from '@/server/db/client';
import { pairFacts } from '@/server/eb-facts';
import type { ClubSession } from '@/server/auth/session';
import { PASSWORD, cookieFrom, createBoxer, createClubWithUser, ctx, daysFromNow, json, owner, req, yearsAgo } from './helpers';

afterAll(async () => {
  await closeDb();
});

// Categories go by birth year, so dates are built from the current year. 1 January has always passed.
const Y = new Date().getUTCFullYear();
const born = (yearsBefore: number, monthDay = '01-01') => `${Y - yearsBefore}-${monthDay}`;

async function clubCtx() {
  const { club, user } = await createClubWithUser({ status: 'approved' });
  const cookie = cookieFrom(await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
  const session: ClubSession = { sessionId: '', clubUserId: user.id, clubId: club.id, email: user.email, clubName: club.name, clubSlug: club.slug, clubStatus: 'approved', isDemoClub: false };
  return { club, cookie, session };
}
type C = Awaited<ReturnType<typeof clubCtx>>;
const post = (handler: (r: never, c: never) => Promise<Response>, c: C, path: string, body: unknown) =>
  handler(req('POST', path, { cookies: { rp_session: c.cookie }, body }) as never, ctx as never);
const propose = (a: C, mine: string, theirs: string, o: Record<string, unknown> = {}) =>
  post(proposeApi, a, '/api/proposals', { proposingBoxerId: mine, receivingBoxerId: theirs, weightKg: 64, boutType: 'competitive', proposedDate: daysFromNow(30), message: '', ...o });
const fields = async (res: Response) => (await json<{ error: { fields: Record<string, string> } }>(res)).error.fields;

describe('England Boxing 2026 matrix: categories in the database', () => {
  it('sets categories by birth year, with Minors from the 10th birthday', async () => {
    const on = `${Y}-11-21`;
    const cat = async (dob: string) => (await owner.query(`select eb_category($1::date, $2::date) as c`, [dob, on])).rows[0].c;
    expect(await cat(`${Y - 10}-12-01`)).toBe('too_young');
    expect(await cat(`${Y - 10}-01-01`)).toBe('minor');
    expect(await cat(`${Y - 11}-06-01`)).toBe('minor');
    expect(await cat(`${Y - 12}-12-31`)).toBe('schools');
    expect(await cat(`${Y - 14}-01-01`)).toBe('schools');
    expect(await cat(`${Y - 15}-01-01`)).toBe('junior');
    expect(await cat(`${Y - 16}-12-31`)).toBe('junior');
    expect(await cat(`${Y - 17}-01-01`)).toBe('youth');
    expect(await cat(`${Y - 18}-12-31`)).toBe('youth');
    expect(await cat(`${Y - 19}-12-31`)).toBe('senior');
    expect(await cat(`${Y - 40}-01-01`)).toBe('senior');
    expect(await cat(`${Y - 41}-12-31`)).toBe('outside');
  });

  it('returns only categories and a gap band, and only for the caller’s own boxer', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const aBoxer = await createBoxer(a.club.id, { dob: born(16) });
    const bBoxer = await createBoxer(b.club.id, { dob: born(15, '02-01') });
    const facts = await withClub(a.club.id, (tx) => pairFacts(tx, aBoxer, [bBoxer]));
    expect(facts.get(bBoxer)).toEqual({ ownCategory: 'junior', category: 'junior', gapBand: 'lt24', ownSkillsAge: false, skillsAge: true });
    // Club B cannot use club A's boxer as "own" to learn anything.
    expect((await withClub(b.club.id, (tx) => pairFacts(tx, aBoxer, [bBoxer]))).size).toBe(0);
    const cols = await owner.query(`select column_name from information_schema.routine_columns where routine_name = 'eb_pair_facts' order by ordinal_position`).catch(() => ({ rows: [] }));
    expect(JSON.stringify(cols.rows)).not.toMatch(/birth/);
  });
});

describe('England Boxing 2026 matrix: rules', () => {
  const f = (o: Partial<PairFacts>): PairFacts => ({ ownCategory: 'junior', category: 'junior', gapBand: 'lt12', ownSkillsAge: true, skillsAge: true, ...o });
  const box = (o: Partial<{ weightKg: number; totalBouts: number; skillsBouts: number }> = {}) => ({ weightKg: 50, totalBouts: 0, skillsBouts: 0, ...o });

  it('allows only the matrix pairings, each with its age gap', () => {
    expect(competitiveCheck(f({}), box(), box()).fails).toEqual([]);
    expect(competitiveCheck(f({ gapBand: 'lt24' }), box(), box())).toEqual({ fails: [], flags: [expect.stringMatching(/extra caution/)] });
    expect(competitiveCheck(f({ gapBand: 'ge24' }), box(), box()).fails[0]).toMatch(/under 24 months for Junior v Junior/);
    expect(competitiveCheck(f({ category: 'youth', gapBand: 'lt24' }), box(), box()).fails[0]).toMatch(/under 12 months for Junior v Youth/);
    expect(competitiveCheck(f({ ownCategory: 'schools', category: 'youth' }), box(), box()).fails[0]).toMatch(/does not allow Schools v Youth/);
    expect(competitiveCheck(f({ ownCategory: 'junior', category: 'senior' }), box(), box()).fails[0]).toMatch(/does not allow Junior v Senior/);
    expect(competitiveCheck(f({ ownCategory: 'minor', category: 'schools' }), box(), box()).fails).toEqual([]);
    expect(competitiveCheck(f({ ownCategory: 'minor', category: 'junior' }), box(), box()).fails[0]).toMatch(/does not allow Minor v Junior/);
    expect(competitiveCheck(f({ ownCategory: 'senior', category: 'youth' }), box(), box()).flags).toContain('Senior v Youth: both boxers must wear head guards');
    expect(competitiveCheck(f({ ownCategory: 'senior', category: 'senior', gapBand: 'ge24' }), box(), box()).fails).toEqual([]);
    expect(competitiveCheck(f({ category: 'too_young' }), box(), box()).fails).toEqual(['England Boxing does not allow under-10s to box']);
    expect(competitiveCheck(f({ ownCategory: 'senior', category: 'outside' }), box(), box()).fails[0]).toMatch(/before 1986/);
  });

  it('applies the 2 kg limit to Minors and Schools, and flags it for others', () => {
    expect(competitiveCheck(f({ ownCategory: 'schools', category: 'schools' }), box({ weightKg: 40 }), box({ weightKg: 42 })).fails).toEqual([]);
    expect(competitiveCheck(f({ ownCategory: 'schools', category: 'schools' }), box({ weightKg: 40 }), box({ weightKg: 42.5 })).fails[0]).toMatch(/limit for Minors and Schools is 2 kg/);
    const senior = competitiveCheck(f({ ownCategory: 'senior', category: 'senior' }), box({ weightKg: 70 }), box({ weightKg: 73 }));
    expect(senior.fails).toEqual([]);
    expect(senior.flags[0]).toMatch(/smaller weight category’s span/);
  });

  it('applies Annex C2 to skills bouts', () => {
    expect(skillsCheck(f({}), box(), box())).toEqual([]);
    expect(skillsCheck(f({ ownSkillsAge: false }), box(), box())[0]).toMatch(/10th birthday to the day before their 16th/);
    expect(skillsCheck(f({ gapBand: 'lt24' }), box(), box())[0]).toMatch(/within 12 months/);
    expect(skillsCheck(f({}), box({ weightKg: 50 }), box({ weightKg: 52.5 }))[0]).toMatch(/over 2 kg/);
    expect(skillsCheck(f({}), box({ totalBouts: 1 }), box())[0]).toMatch(/first competitive bout/);
    expect(skillsCheck(f({}), box(), box({ skillsBouts: 6 }))[0]).toMatch(/at most 6/);
  });
});

describe('England Boxing 2026 matrix: enforced by the server', () => {
  it('refuses proposals the matrix does not allow and accepts those it does', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const junior = await createBoxer(a.club.id, { dob: born(16) });
    const youth12 = await createBoxer(b.club.id, { dob: born(17) }); // exactly 12 months older: too far for Junior v Youth
    const res = await propose(a, junior, youth12);
    expect(res.status).toBe(422);
    expect((await fields(res)).receivingBoxerId).toMatch(/under 12 months for Junior v Youth/);

    const juniorClose = await createBoxer(b.club.id, { dob: born(15, '02-01') }); // 13 months: allowed with caution
    expect((await propose(a, junior, juniorClose)).status).toBe(201);

    const schoolsA = await createBoxer(a.club.id, { dob: born(13), weightKg: 40 });
    const schoolsB = await createBoxer(b.club.id, { dob: born(13, '03-01'), weightKg: 42.5 });
    expect((await fields(await propose(a, schoolsA, schoolsB, { weightKg: 41 }))).receivingBoxerId).toMatch(/2 kg/);

    const over40 = await createBoxer(a.club.id, { dob: born(41) });
    const senior = await createBoxer(b.club.id, { dob: yearsAgo(30) });
    expect((await fields(await propose(a, over40, senior))).receivingBoxerId).toMatch(/before 1986/);
  });

  it('refuses skills bouts outside Annex C2', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const mine = await createBoxer(a.club.id, { dob: born(15, '03-01'), weightKg: 50 });
    const theirs = await createBoxer(b.club.id, { dob: born(15, '05-01'), weightKg: 51 });
    await owner.query(`update boxers set competitive_wins = 1 where id = $1`, [theirs]);
    const res = await propose(a, mine, theirs, { boutType: 'skills', weightKg: 50 });
    expect(res.status).toBe(422);
    expect((await fields(res)).boutType).toMatch(/first competitive bout/);
    // The same pairing is fine as a competitive bout.
    expect((await propose(a, mine, theirs)).status).toBe(201);
  });

  it('keeps under-10s out of matchmaking and sparring', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const nine = await createBoxer(a.club.id, { dob: yearsAgo(9), weightKg: 31.7 });
    await createBoxer(b.club.id, { dob: yearsAgo(9), weightKg: 31.7 });
    const res = await post(createSparApi, a, '/api/sparring', { boxerId: nine, availabilityNote: 'Weekends', location: 'Leeds' });
    expect(res.status).toBe(422);
    expect((await fields(res)).boxerId).toMatch(/under-10s to spar/);
    const search = await searchMatches(a.session, nine, matchQuerySchema.parse({}));
    expect(search!.ownCategory).toBe('too_young');
    expect(search!.suitable).toEqual([]);
  });

  it('shows categories and matrix cautions in matchmaking', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const mine = await createBoxer(a.club.id, { dob: born(16), weightKg: 57.3 });
    const close = await createBoxer(b.club.id, { dob: born(15, '02-01'), weightKg: 57.3 });
    const far = await createBoxer(b.club.id, { dob: born(17), weightKg: 57.3 }); // Youth, 12 months: refused
    const search = await searchMatches(a.session, mine, matchQuerySchema.parse({ ageGap: '2' }));
    expect(search!.ownCategory).toBe('junior');
    const ok = search!.suitable.find((r) => r.id === close)!;
    expect(ok.category).toBe('junior');
    expect(ok.flags).toContain('More than 12 months apart in age: England Boxing advises extra caution');
    expect(search!.suitable.some((r) => r.id === far)).toBe(false);
    expect(search!.blocked.find((r) => r.id === far)!.blocked).toContain('Age gap must be under 12 months for Junior v Youth');
  });
});
