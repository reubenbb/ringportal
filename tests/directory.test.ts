import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { POST as setAddress } from '@/app/api/admin/directory/[id]/address/route';
import { POST as adminLogin } from '@/app/api/admin/auth/login/route';
import { POST as adminMfa } from '@/app/api/admin/auth/mfa/route';
import { POST as clubLogin } from '@/app/api/auth/login/route';
import { closeDb } from '@/server/db/client';
import { importEnglandBoxingDirectory } from '@/server/directory/import';
import { normalisePostcode, normaliseSocial, normaliseWebsite, parseDirectoryRow } from '@/server/directory/normalise';
import { PASSWORD, cookieFrom, createClubWithUser, createPlatformUser, ctx, idCtx, owner, req, totpFor } from './helpers';
import { TEST_APP_URL } from './test-config';

const EB = 'https://englandboxing.sport80.com/public/widget/1';
const HEADER = 'official_id,name,region,address,postcode,website,social_reference,source_url,membership_type,listed_status,address_missing,address_discrepancy';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

afterAll(async () => {
  await closeDb();
});

describe('normalisation (pure)', () => {
  it('formats valid UK postcodes and leaves others as supplied', () => {
    expect(normalisePostcode('bn25he')).toBe('BN2 5HE');
    expect(normalisePostcode(' SW1A 1AA ')).toBe('SW1A 1AA');
    expect(normalisePostcode('D02 X285')).toBe('D02 X285');
    expect(normalisePostcode('NR32. 1XE')).toBe('NR32 1XE');
    expect(normalisePostcode('RM8 2JR.')).toBe('RM8 2JR');
    expect(normalisePostcode('not a postcode')).toBeNull();
    expect(normalisePostcode('')).toBeNull();
  });

  it('accepts only http(s) websites and never Warrior Boxing URLs', () => {
    expect(normaliseWebsite('https://club.example')).toBe('https://club.example/');
    expect(normaliseWebsite('javascript:alert(1)')).toBeNull();
    expect(normaliseWebsite('www.no-scheme.example')).toBeNull();
    expect(normaliseWebsite('https://www.warriorboxing.com/clubpage.php?id=1')).toBeNull();
  });

  it('strips tracking parameters from social links', () => {
    expect(normaliseSocial('Instagram: https://www.instagram.com/club?igsh=abc&utm_source=qr')).toBe('Instagram: https://www.instagram.com/club');
  });

  it('keeps clubs whose own names contain "Warriors"', () => {
    const r = parseDirectoryRow({ official_id: '873187', name: 'Hemel Warriors ABC', source_url: EB, website: 'https://www.warriorsabc.com' });
    expect(r.ok && r.record.name).toBe('Hemel Warriors ABC');
    expect(r.ok && r.record.website).toBe('https://www.warriorsabc.com/');
  });

  it('rejects rows that cannot be attributed to the England Boxing directory', () => {
    expect(parseDirectoryRow({ official_id: '1', name: 'X Club', source_url: 'https://www.warriorboxing.com/x' })).toEqual({ ok: false, reason: 'source_not_england_boxing' });
    expect(parseDirectoryRow({ official_id: '', name: 'X Club', source_url: EB })).toEqual({ ok: false, reason: 'missing_or_invalid_official_id' });
  });
});

describe('England Boxing directory import', () => {
  it('imports the real cleaned file: all records attributed, all addresses unverified, no Warrior references', async () => {
    const text = readFileSync('data/england-boxing-directory.csv', 'utf8');
    const s = await importEnglandBoxingDirectory(text);
    expect(s).toMatchObject({ rowsTotal: 1043, inserted: 1043, skipped: 0 });
    const { rows } = await owner.query(`
      select count(*)::int as n,
        count(*) filter (where source = 'england_boxing_directory' and source_url like 'https://englandboxing.sport80.com/%')::int as attributed,
        count(*) filter (where address_status = 'unverified')::int as unverified,
        count(*) filter (where address_flag = 'differs_from_map')::int as flagged,
        count(*) filter (where address_flag = 'missing')::int as missing,
        count(*) filter (where row_to_json(directory_clubs)::text ilike '%warriorboxing%')::int as warrior_refs
      from directory_clubs`);
    expect(rows[0]).toEqual({ n: 1043, attributed: 1043, unverified: 1043, flagged: 70, missing: 255, warrior_refs: 0 });

    const brighton = await owner.query(`select name, postcode, address_flag, address_status from directory_clubs where source_ref = '997269'`);
    expect(brighton.rows[0]).toEqual({ name: 'Brighton Boxing Academy', postcode: 'BN2 5HE', address_flag: 'differs_from_map', address_status: 'unverified' });
  });

  it('re-importing the same file creates no duplicates and changes nothing', async () => {
    const s = await importEnglandBoxingDirectory(readFileSync('data/england-boxing-directory.csv', 'utf8'));
    expect(s).toMatchObject({ inserted: 0, updated: 0, unchanged: 1043, addressConflicts: 0 });
    const { rows } = await owner.query(`select count(*)::int as n from directory_clubs`);
    expect(rows[0].n).toBe(1043);
  });

  it('never overwrites an address an administrator has verified', async () => {
    await importEnglandBoxingDirectory(csv(`T1,Test Verify Club,London,1 Old Road,E1 6AN,,,${EB},Club Membership,Current,0,0`));
    await owner.query(`update directory_clubs set address_status = 'verified', address_verified_at = now() where source_ref = 'T1'`);
    const s = await importEnglandBoxingDirectory(csv(`T1,Test Verify Club,London,99 New Road,E1 6AN,,,${EB},Club Membership,Current,0,0`));
    expect(s.addressConflicts).toBe(1);
    const { rows } = await owner.query(`select address, address_status from directory_clubs where source_ref = 'T1'`);
    expect(rows[0]).toEqual({ address: '1 Old Road', address_status: 'verified' });
  });

  it('updates unverified addresses from a newer file', async () => {
    await importEnglandBoxingDirectory(csv(`T2,Test Update Club,London,1 First St,E1 6AN,,,${EB},Club Membership,Current,0,0`));
    const s = await importEnglandBoxingDirectory(csv(`T2,Test Update Club,London,2 Second St,E1 6AN,,,${EB},Club Membership,Current,0,0`));
    expect(s.updated).toBe(1);
    const { rows } = await owner.query(`select address, address_status from directory_clubs where source_ref = 'T2'`);
    expect(rows[0]).toEqual({ address: '2 Second St', address_status: 'unverified' });
  });

  it('skips duplicates within a file and records why', async () => {
    const s = await importEnglandBoxingDirectory(
      csv(`T3,Dup Club,London,,,,,${EB},,,1,0`, `T3,Dup Club Again,London,,,,,${EB},,,1,0`, `T4,Bad Source Club,London,,,,,https://example.com,,,1,0`),
    );
    expect(s.skippedReasons).toEqual({ duplicate_official_id: 1, source_not_england_boxing: 1 });
  });

  it('records an audit entry for each import', async () => {
    const { rows } = await owner.query(`select count(*)::int as n from audit_log where action = 'directory.import_completed'`);
    expect(rows[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe('directory access control', () => {
  const app = new Client({ connectionString: TEST_APP_URL });
  beforeAll(() => app.connect());
  afterAll(() => app.end());

  it('a club context can read but not alter directory records, and cannot see import runs', async () => {
    const { club } = await createClubWithUser();
    await app.query('begin');
    await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', $1, true)`, [club.id]);
    const read = await app.query(`select count(*)::int as n from directory_clubs`);
    expect(read.rows[0].n).toBeGreaterThan(0);
    const upd = await app.query(`update directory_clubs set address_status = 'verified', address_verified_at = now() where source_ref = '997269'`);
    expect(upd.rowCount).toBe(0);
    const runs = await app.query(`select count(*)::int as n from directory_import_runs`);
    expect(runs.rows[0].n).toBe(0);
    await app.query('rollback');
  });

  it('nothing is visible without a request context', async () => {
    const { rows } = await app.query(`select count(*)::int as n from directory_clubs`);
    expect(rows[0].n).toBe(0);
  });

  it('a directory profile cannot sign in', async () => {
    const res = await clubLogin(req('POST', '/api/auth/login', { body: { email: 'brighton@example.test', password: PASSWORD } }), ctx);
    expect(res.status).toBe(401);
  });
});

describe('admin address verification', () => {
  async function adminSession() {
    const admin = await createPlatformUser();
    const p = await adminLogin(req('POST', '/api/admin/auth/login', { body: { email: admin.email, password: PASSWORD } }), ctx);
    const m = await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: cookieFrom(p, 'rp_admin_mfa')! }, body: { code: totpFor(admin.secret!) } }), ctx);
    return { admin, session: cookieFrom(m, 'rp_admin')! };
  }
  const idOf = async (ref: string) => (await owner.query(`select id from directory_clubs where source_ref = $1`, [ref])).rows[0].id as string;

  it('verifies with a note, clears the map flag and audits who did it', async () => {
    const { admin, session } = await adminSession();
    const id = await idOf('997269');
    const res = await setAddress(
      req('POST', `/api/admin/directory/${id}/address`, { cookies: { rp_admin: session }, body: { action: 'verify', note: 'Phoned the head coach to confirm the venue' } }),
      idCtx(id),
    );
    expect(res.status).toBe(200);
    const { rows } = await owner.query(`select address_status, address_flag, address_verified_by from directory_clubs where id = $1`, [id]);
    expect(rows[0]).toEqual({ address_status: 'verified', address_flag: null, address_verified_by: admin.id });
    const a = await owner.query(`select actor_id, reason from audit_log where action = 'directory.address_verified' and target_id = $1`, [id]);
    expect(a.rows[0]).toEqual({ actor_id: admin.id, reason: 'Phoned the head coach to confirm the venue' });

    const back = await setAddress(
      req('POST', `/api/admin/directory/${id}/address`, { cookies: { rp_admin: session }, body: { action: 'unverify', note: 'Club reports it has moved' } }),
      idCtx(id),
    );
    expect(back.status).toBe(200);
    const after = await owner.query(`select address_status from directory_clubs where id = $1`, [id]);
    expect(after.rows[0].address_status).toBe('unverified');
  });

  it('requires a note, an address and an admin session', async () => {
    const { session } = await adminSession();
    const id = await idOf('997269');
    const noNote = await setAddress(req('POST', `/api/admin/directory/${id}/address`, { cookies: { rp_admin: session }, body: { action: 'verify', note: '' } }), idCtx(id));
    expect(noNote.status).toBe(422);
    const missingAddr = (await owner.query(`select id from directory_clubs where address is null limit 1`)).rows[0].id as string;
    const none = await setAddress(
      req('POST', `/api/admin/directory/${missingAddr}/address`, { cookies: { rp_admin: session }, body: { action: 'verify', note: 'Checked on site' } }),
      idCtx(missingAddr),
    );
    expect(none.status).toBe(409);
    const { user } = await createClubWithUser();
    const clubCookie = cookieFrom(await clubLogin(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
    const asClub = await setAddress(
      req('POST', `/api/admin/directory/${id}/address`, { cookies: { rp_session: clubCookie, rp_admin: clubCookie }, body: { action: 'verify', note: 'Trust me' } }),
      idCtx(id),
    );
    expect(asClub.status).toBe(401);
  });
});

describe('bundled directory import endpoint', () => {
  async function sessionFor(role: 'owner' | 'admin') {
    const admin = await createPlatformUser({ role });
    const p = await adminLogin(req('POST', '/api/admin/auth/login', { body: { email: admin.email, password: PASSWORD } }), ctx);
    const m = await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: cookieFrom(p, 'rp_admin_mfa')! }, body: { code: totpFor(admin.secret!) } }), ctx);
    return cookieFrom(m, 'rp_admin')!;
  }

  it('bundled file matches the cleaned CSV exactly', async () => {
    const { loadBundledDirectory } = await import('@/server/directory/bundled');
    expect(await loadBundledDirectory()).toBe(readFileSync('data/england-boxing-directory.csv', 'utf8'));
  });

  it('is owner-only, idempotent and attributed to the acting owner', async () => {
    const { POST: importBundled } = await import('@/app/api/admin/directory/import/route');
    const adminCookie = await sessionFor('admin');
    expect((await importBundled(req('POST', '/api/admin/directory/import', { cookies: { rp_admin: adminCookie } }), ctx)).status).toBe(403);
    expect((await importBundled(req('POST', '/api/admin/directory/import'), ctx)).status).toBe(401);
    const ownerCookie = await sessionFor('owner');
    const res = await importBundled(req('POST', '/api/admin/directory/import', { cookies: { rp_admin: ownerCookie } }), ctx);
    expect(res.status).toBe(200);
    const s = (await res.json()) as { inserted: number; updated: number; unchanged: number };
    expect(s.inserted + s.updated + s.unchanged).toBe(1043);
    expect(s.inserted).toBe(0);
    const { rows } = await owner.query(`select actor_type from audit_log where action = 'directory.import_completed' order by id desc limit 1`);
    expect(rows[0].actor_type).toBe('platform_user');
  });
});

describe('origin check on Vercel', () => {
  it('accepts the deployment URL Vercel provides and still rejects other origins', async () => {
    const { allowedOrigins } = await import('@/server/env');
    const prev = process.env.VERCEL_URL;
    process.env.VERCEL_URL = 'ringportal-abc123.vercel.app';
    try {
      const set = allowedOrigins();
      expect(set.has('https://ringportal-abc123.vercel.app')).toBe(true);
      expect(set.has('http://localhost:3000')).toBe(true);
      expect(set.has('https://evil.example')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.VERCEL_URL;
      else process.env.VERCEL_URL = prev;
    }
  });
});
