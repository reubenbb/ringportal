import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as createBoxerApi } from '@/app/api/boxers/route';
import { PUT as updateBoxerApi } from '@/app/api/boxers/[id]/route';
import { POST as availabilityApi } from '@/app/api/boxers/[id]/availability/route';
import { POST as archiveApi } from '@/app/api/boxers/[id]/archive/route';
import { rosterForAdmin, rosterForClubViewer, getOwnBoxer } from '@/server/boxers/service';
import { closeDb } from '@/server/db/client';
import type { ClubSession } from '@/server/auth/session';
import { PASSWORD, cookieFrom, createClubWithUser, ctx, idCtx, json, owner, req } from './helpers';
import { TEST_APP_URL } from './test-config';
import { weightAgeDays, weightIsStale } from '@/lib/boxers';

afterAll(async () => {
  await closeDb();
});

function isoYearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - extraDays);
  return d.toISOString().slice(0, 10);
}

const base = {
  firstName: 'Jack',
  lastName: 'Thompson',
  sex: 'male',
  dateOfBirth: isoYearsAgo(24),
  weightKg: 63.5,
  competitiveWins: 6,
  competitiveLosses: 2,
  competitiveDraws: 1,
  skillsBouts: 4,
  medicalStatus: 'Medical card current',
  notes: 'Private coach note',
};

async function clubCtx(status = 'approved') {
  const { club, user } = await createClubWithUser({ status });
  const cookie = cookieFrom(await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
  const session: ClubSession = { sessionId: '', clubUserId: user.id, clubId: club.id, email: user.email, clubName: club.name, clubSlug: club.slug, clubStatus: status as ClubSession['clubStatus'], isDemoClub: false };
  return { club, user, cookie, session };
}

const create = (cookie: string, body: unknown) => createBoxerApi(req('POST', '/api/boxers', { cookies: { rp_session: cookie }, body }), ctx);

describe('boxer roster management', () => {
  it('an approved club creates a boxer; record and skills bouts stay separate', async () => {
    const a = await clubCtx();
    const res = await create(a.cookie, base);
    expect(res.status).toBe(201);
    const { id } = await json<{ id: string }>(res);
    const own = await getOwnBoxer(a.session, id);
    expect(own!.boxer).toMatchObject({ competitiveWins: 6, competitiveLosses: 2, competitiveDraws: 1, skillsBouts: 4, availability: 'ready', dateOfBirth: base.dateOfBirth });
    expect(own!.history).toHaveLength(1);
    const roster = await rosterForAdmin(a.club.id);
    expect(roster[0]).toMatchObject({ totalBouts: 9, skillsBouts: 4 });
  });

  it('unapproved clubs cannot manage boxers', async () => {
    const pending = await clubCtx('submitted');
    expect((await create(pending.cookie, base)).status).toBe(403);
  });

  it('validates input server-side', async () => {
    const a = await clubCtx();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const res = await create(a.cookie, { ...base, dateOfBirth: tomorrow, weightKg: 250, competitiveWins: -1, sex: 'other', firstName: '' });
    expect(res.status).toBe(422);
    const { error } = await json<{ error: { fields: Record<string, string> } }>(res);
    expect(Object.keys(error.fields).sort()).toEqual(['competitiveWins', 'dateOfBirth', 'firstName', 'sex', 'weightKg']);
  });

  it('records who changed availability and when; unknown statuses are rejected', async () => {
    const a = await clubCtx();
    const { id } = await json<{ id: string }>(await create(a.cookie, base));
    const change = (status: string) => availabilityApi(req('POST', `/api/boxers/${id}/availability`, { cookies: { rp_session: a.cookie }, body: { status } }), idCtx(id));
    expect(await json(await change('injured_medical'))).toEqual({ changed: true });
    expect(await json(await change('injured_medical'))).toEqual({ changed: false });
    expect((await change('retired')).status).toBe(422);
    const { history } = (await getOwnBoxer(a.session, id))!;
    expect(history[0]).toMatchObject({ fromStatus: 'ready', toStatus: 'injured_medical', changedBy: a.user.email });
  });

  it('audit entries never contain date of birth, medical status or notes', async () => {
    const a = await clubCtx();
    const { id } = await json<{ id: string }>(await create(a.cookie, base));
    await updateBoxerApi(req('PUT', `/api/boxers/${id}`, { cookies: { rp_session: a.cookie }, body: { ...base, notes: 'Changed secret note', dateOfBirth: isoYearsAgo(25) } }), idCtx(id));
    const { rows } = await owner.query(`select metadata::text as m from audit_log where target_id = $1`, [id]);
    const all = rows.map((r) => r.m).join(' ');
    expect(all).toContain('notes');
    expect(all).not.toContain('Changed secret note');
    expect(all).not.toContain('Medical card current');
    expect(all).not.toContain(isoYearsAgo(25));
  });

  it('another club cannot edit, re-status or archive a boxer (same 404 as unknown)', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const { id } = await json<{ id: string }>(await create(a.cookie, base));
    const upd = await updateBoxerApi(req('PUT', `/api/boxers/${id}`, { cookies: { rp_session: b.cookie }, body: { ...base, lastName: 'Hijacked' } }), idCtx(id));
    const av = await availabilityApi(req('POST', `/api/boxers/${id}/availability`, { cookies: { rp_session: b.cookie }, body: { status: 'inactive' } }), idCtx(id));
    const ar = await archiveApi(req('POST', `/api/boxers/${id}/archive`, { cookies: { rp_session: b.cookie }, body: { archived: true } }), idCtx(id));
    expect([upd.status, av.status, ar.status]).toEqual([404, 404, 404]);
    const { rows } = await owner.query(`select last_name, availability, archived_at from boxers where id = $1`, [id]);
    expect(rows[0]).toEqual({ last_name: 'Thompson', availability: 'ready', archived_at: null });
  });
});

describe('cross-club visibility and junior privacy', () => {
  const app = new Client({ connectionString: TEST_APP_URL });
  let a: Awaited<ReturnType<typeof clubCtx>>;
  let b: Awaited<ReturnType<typeof clubCtx>>;
  let adultId: string;
  let juniorId: string;

  beforeAll(async () => {
    await app.connect();
    a = await clubCtx();
    b = await clubCtx();
    adultId = (await json<{ id: string }>(await create(a.cookie, base))).id;
    juniorId = (await json<{ id: string }>(await create(a.cookie, { ...base, firstName: 'Lewis', lastName: 'Carter', dateOfBirth: isoYearsAgo(14), weightKg: 48, guardianConsent: true }))).id;
    const archived = (await json<{ id: string }>(await create(a.cookie, { ...base, firstName: 'Old', lastName: 'Boxer' }))).id;
    await archiveApi(req('POST', `/api/boxers/${archived}/archive`, { cookies: { rp_session: a.cookie }, body: { archived: true } }), idCtx(archived));
  });
  afterAll(() => app.end());

  it('another approved club sees a minimised roster: junior names shortened, no DOB, medical or notes', async () => {
    const roster = await rosterForClubViewer(b.session, a.club.id);
    expect(roster.map((r) => r.displayName).sort()).toEqual(['Jack Thompson', 'Lewis C.']);
    const junior = roster.find((r) => r.id === juniorId)!;
    expect(junior).toMatchObject({ isJunior: true, ageYears: 14, weightKg: 48 });
    const text = JSON.stringify(roster);
    for (const secret of ['dateOfBirth', 'date_of_birth', base.dateOfBirth, 'Medical card current', 'Private coach note', 'Carter']) {
      expect(text).not.toContain(secret);
    }
  });

  it('archived boxers are not shown to other clubs', async () => {
    const roster = await rosterForClubViewer(b.session, a.club.id);
    expect(roster.some((r) => r.displayName === 'Old Boxer')).toBe(false);
  });

  it('an unapproved viewer, or an unapproved target club, gets nothing', async () => {
    const pending = await clubCtx('submitted');
    expect(await rosterForClubViewer(pending.session, a.club.id)).toEqual([]);
    await owner.query(`update clubs set status = 'suspended' where id = $1`, [a.club.id]);
    expect(await rosterForClubViewer(b.session, a.club.id)).toEqual([]);
    await owner.query(`update clubs set status = 'approved' where id = $1`, [a.club.id]);
  });

  it('as the app role, another club cannot read base boxer tables directly', async () => {
    await app.query('begin');
    await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [b.club.id]);
    for (const t of ['boxers', 'boxer_private', 'boxer_availability_history']) {
      const { rows } = await app.query(`select count(*)::int as n from ${t} where club_id = $1`, [a.club.id]);
      expect(rows[0].n, t).toBe(0);
    }
    const upd = await app.query(`update boxer_private set notes = 'x' where boxer_id = $1`, [adultId]);
    expect(upd.rowCount).toBe(0);
    await expect(app.query(`delete from boxers where id = $1`, [adultId])).rejects.toThrow(/permission denied/);
    await app.query('rollback');
  });

  it('the roster function returns nothing without an authenticated context', async () => {
    const { rows } = await app.query(`select count(*)::int as n from club_boxer_roster($1)`, [a.club.id]);
    expect(rows[0].n).toBe(0);
  });

  it('a club cannot insert a boxer into another club', async () => {
    await app.query('begin');
    await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [b.club.id]);
    await expect(
      app.query(`insert into boxers (club_id, first_name, last_name, sex, weight_kg) values ($1, 'X', 'Y', 'male', 60)`, [a.club.id]),
    ).rejects.toThrow(/row-level security/);
    await app.query('rollback');
  });
});

describe('approved club listing', () => {
  it('lists approved clubs with public fields only; unapproved viewers and clubs are excluded', async () => {
    const { listApprovedClubsForClub } = await import('@/server/boxers/service');
    const a = await clubCtx();
    const b = await clubCtx();
    const pending = await clubCtx('submitted');
    await owner.query(`update clubs set affiliation_number = 'AFF-SECRET-1', status_reason = 'internal reason' where id = $1`, [a.club.id]);
    await create(a.cookie, base);
    const seen = await listApprovedClubsForClub(b.session);
    const entry = seen.find((c) => c.id === a.club.id)!;
    expect(entry).toMatchObject({ name: a.club.name, slug: a.club.slug, governingBody: 'England Boxing', activeBoxers: 1 });
    expect(Object.keys(entry).sort()).toEqual(['activeBoxers', 'governingBody', 'id', 'isDemo', 'name', 'slug']);
    expect(JSON.stringify(seen)).not.toContain('AFF-SECRET-1');
    expect(seen.some((c) => c.id === pending.club.id)).toBe(false);
    expect(await listApprovedClubsForClub(pending.session)).toEqual([]);
  });
});

describe('weight recency', () => {
  it('records when the weight was entered; only a weight change moves it, and it cannot be set directly', async () => {
    const { club } = await createClubWithUser({ status: 'approved' });
    const { rows: [b] } = await owner.query(
      `insert into boxers (club_id, first_name, last_name, sex, weight_kg) values ($1, 'Wren', 'Scale', 'male', 64) returning id, weight_recorded_at`,
      [club.id],
    );
    const at = async () => (await owner.query(`select weight_recorded_at from boxers where id = $1`, [b.id])).rows[0].weight_recorded_at as Date;
    expect(b.weight_recorded_at).toBeInstanceOf(Date);
    await owner.query(`update boxers set weight_recorded_at = now() - interval '90 days' where id = $1`, [b.id]);
    expect((await at()).getTime()).toBe(b.weight_recorded_at.getTime());
    await owner.query(`update boxers set first_name = 'Wren2', weight_kg = 64 where id = $1`, [b.id]);
    expect((await at()).getTime()).toBe(b.weight_recorded_at.getTime());
    await new Promise((r) => setTimeout(r, 20));
    await owner.query(`update boxers set weight_kg = 65.5 where id = $1`, [b.id]);
    expect((await at()).getTime()).toBeGreaterThan(b.weight_recorded_at.getTime());
  });

  it('flags a weight older than the RingPortal default', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    expect(weightAgeDays('2026-10-24T12:00:00Z', now)).toBe(28);
    expect(weightIsStale('2026-10-24T12:00:00Z', now)).toBe(false);
    expect(weightIsStale('2026-10-23T11:00:00Z', now)).toBe(true);
    expect(weightAgeDays('2026-11-22T12:00:00Z', now)).toBe(0);
  });
});
