import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as uploadApi, DELETE as removeApi } from '@/app/api/club/logo/route';
import { GET as logoApi } from '@/app/api/clubs/[id]/logo/route';
import { normaliseLogo, sniffImage } from '@/server/clubs/logo';
import { closeDb } from '@/server/db/client';
import { PASSWORD, cookieFrom, createClubWithUser, ctx, idCtx, owner, req } from './helpers';
import { TEST_ORIGIN } from './test-config';

afterAll(async () => {
  await closeDb();
});

async function clubCtx(status = 'approved') {
  const { club, user } = await createClubWithUser({ status });
  const cookie = cookieFrom(await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
  return { club, cookie };
}

function upload(cookie: string, data: Buffer, opts: { origin?: string } = {}) {
  const form = new FormData();
  form.append('logo', new Blob([new Uint8Array(data)], { type: 'image/png' }), 'logo.png');
  return uploadApi(
    new NextRequest(new URL('/api/club/logo', TEST_ORIGIN), {
      method: 'POST',
      headers: { cookie: `rp_session=${cookie}`, origin: opts.origin ?? TEST_ORIGIN, 'sec-fetch-site': opts.origin ? 'cross-site' : 'same-origin', 'x-forwarded-for': '10.9.9.9' },
      body: form,
    }),
    ctx,
  );
}
const view = (cookie: string, clubId: string) => logoApi(req('GET', `/api/clubs/${clubId}/logo`, { cookies: { rp_session: cookie } }), idCtx(clubId) as never);

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#087cff' } }).png().toBuffer();

describe('club logos', () => {
  it('re-encodes uploads to a small WebP without metadata, and serves it to approved clubs only', async () => {
    const a = await clubCtx();
    const b = await clubCtx();
    const pending = await clubCtx('under_review');
    const withExif = await sharp(await png(1200, 600)).withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } }).jpeg().toBuffer();
    const res = await upload(a.cookie, withExif);
    expect(res.status).toBe(200);

    const stored = (await owner.query(`select image, width, height from club_logos where club_id = $1`, [a.club.id])).rows[0];
    expect(sniffImage(stored.image)).toBe('webp');
    expect([stored.width, stored.height]).toEqual([256, 128]);
    expect(stored.image.toString('latin1')).not.toContain('secret-gps-owner');

    const seen = await view(b.cookie, a.club.id);
    expect(seen.status).toBe(200);
    expect(seen.headers.get('content-type')).toBe('image/webp');
    expect(seen.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await view(a.cookie, a.club.id)).status).toBe(200);
    expect((await view(pending.cookie, a.club.id)).status).toBe(404); // unapproved clubs cannot see other clubs
    const anon = await logoApi(req('GET', `/api/clubs/${a.club.id}/logo`), idCtx(a.club.id) as never);
    expect(anon.status).toBe(401);

    // A pending club can manage its own logo, but approved clubs cannot see it yet.
    expect((await upload(pending.cookie, await png(64, 64))).status).toBe(200);
    expect((await view(pending.cookie, pending.club.id)).status).toBe(200);
    expect((await view(a.cookie, pending.club.id)).status).toBe(404);

    const del = await removeApi(req('DELETE', '/api/club/logo', { cookies: { rp_session: a.cookie }, headers: { 'sec-fetch-site': 'same-origin' } }), ctx);
    expect(del.status).toBe(200);
    expect((await view(b.cookie, a.club.id)).status).toBe(404);
    const actions = (await owner.query(`select action from audit_log where club_id = $1 and action like 'club.logo%' order by id`, [a.club.id])).rows.map((r) => r.action);
    expect(actions).toEqual(['club.logo_updated', 'club.logo_removed']);
  });

  it('rejects non-images, disguised files, oversized files, huge dimensions and cross-site uploads', async () => {
    const a = await clubCtx();
    expect((await upload(a.cookie, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).status).toBe(422);
    expect((await upload(a.cookie, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not really a png')]))).status).toBe(422);
    expect((await upload(a.cookie, Buffer.alloc(1024 * 1024 + 1, 1))).status).toBe(422);
    await expect(normaliseLogo(await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer())).rejects.toMatchObject({ code: 'validation_failed' });
    expect((await upload(a.cookie, await png(10, 10), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await owner.query(`select count(*)::int as n from club_logos where club_id = $1`, [a.club.id])).rows[0].n).toBe(0);
  });
});
