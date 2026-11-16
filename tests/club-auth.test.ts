import { afterAll, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as me } from '@/app/api/me/route';
import { POST as changePassword } from '@/app/api/account/password/route';
import { GET as listSessions } from '@/app/api/account/sessions/route';
import { DELETE as revokeSession } from '@/app/api/account/sessions/[id]/route';
import { GET as adminAudit } from '@/app/api/admin/audit/route';
import { closeDb } from '@/server/db/client';
import { PASSWORD, cookieFrom, createClubWithUser, createClubUser, ctx, idCtx, json, owner, randomUUID, req, setCookieHeader } from './helpers';

afterAll(async () => {
  await closeDb();
});

async function signIn(email: string, password = PASSWORD, ip?: string) {
  const res = await login(req('POST', '/api/auth/login', { body: { email, password }, ip }), ctx);
  return { res, token: cookieFrom(res, 'rp_session') };
}

describe('club sign-in', () => {
  it('sets an HttpOnly, SameSite session cookie and resolves the club from it', async () => {
    const { club, user } = await createClubWithUser();
    const { res, token } = await signIn(user.email);
    expect(res.status).toBe(200);
    const header = setCookieHeader(res, 'rp_session')!;
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);
    expect(header).toMatch(/Path=\//);
    expect(token).toBeTruthy();

    const meRes = await me(req('GET', '/api/me', { cookies: { rp_session: token! } }), ctx);
    expect(meRes.status).toBe(200);
    const body = await json<{ club: { name: string } }>(meRes);
    expect(body.club.name).toBe(club.name);
  });

  it('accepts email case-insensitively', async () => {
    const { user } = await createClubWithUser();
    const { res } = await signIn(user.email.toUpperCase());
    expect(res.status).toBe(200);
  });

  it('returns the same generic error for a wrong password and an unknown account', async () => {
    const { user } = await createClubWithUser();
    const wrong = await signIn(user.email, 'not the right password');
    const unknown = await signIn('nobody-here@example.test');
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
    expect(await json(wrong.res)).toEqual(await json(unknown.res));
    expect(wrong.token).toBeUndefined();
  });

  it('refuses a disabled account', async () => {
    const { club } = await createClubWithUser();
    const disabled = await createClubUser(club.id, { status: 'disabled' });
    expect((await signIn(disabled.email)).res.status).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const { user } = await createClubWithUser();
    const { token } = await signIn(user.email);
    const { rows } = await owner.query(`select encode(token_hash, 'hex') as h from club_sessions s join club_users u on u.id = s.club_user_id where u.email = $1`, [user.email]);
    expect(rows).toHaveLength(1);
    expect(rows[0].h).not.toContain(Buffer.from(token!).toString('hex'));
  });

  it('rate-limits repeated failures per account across different IPs', async () => {
    const { user } = await createClubWithUser();
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++) statuses.push((await signIn(user.email, 'wrong password!!')).res.status);
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses[8]).toBe(429);
    // Even the right password is refused while limited.
    const limited = await signIn(user.email);
    expect(limited.res.status).toBe(429);
    expect(limited.res.headers.get('retry-after')).toBeTruthy();
  });

  it('records failed and successful sign-ins in the audit log without secrets', async () => {
    const { club, user } = await createClubWithUser();
    await signIn(user.email, 'wrong password!!');
    await signIn(user.email);
    const { rows } = await owner.query(`select action, metadata::text from audit_log where club_id = $1 order by id`, [club.id]);
    expect(rows.map((r) => r.action)).toEqual(['club.login_failed', 'club.login']);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
  });
});

describe('CSRF and request hygiene', () => {
  it('rejects a cross-site origin', async () => {
    const { user } = await createClubWithUser();
    const res = await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD }, origin: 'https://evil.example' }), ctx);
    expect(res.status).toBe(403);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe('csrf_rejected');
  });

  it('rejects a request with neither Origin nor same-origin fetch metadata', async () => {
    const { user } = await createClubWithUser();
    const res = await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD }, origin: null }), ctx);
    expect(res.status).toBe(403);
  });

  it('accepts same-origin fetch metadata when Origin is absent', async () => {
    const { user } = await createClubWithUser();
    const res = await login(
      req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD }, origin: null, headers: { 'sec-fetch-site': 'same-origin' } }),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it('rejects form-encoded bodies (no simple cross-site POST)', async () => {
    const res = await login(
      req('POST', '/api/auth/login', { rawBody: 'email=a@b.c&password=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('returns field-level validation errors in a consistent structure', async () => {
    const res = await login(req('POST', '/api/auth/login', { body: { email: 'not-an-email', password: '' } }), ctx);
    expect(res.status).toBe(422);
    const body = await json<{ error: { code: string; fields: Record<string, string> } }>(res);
    expect(body.error.code).toBe('validation_failed');
    expect(Object.keys(body.error.fields).sort()).toEqual(['email', 'password']);
  });

  it('ignores unexpected fields such as a club id in the body (no mass assignment)', async () => {
    const victim = await createClubWithUser();
    const attacker = await createClubWithUser();
    const res = await login(req('POST', '/api/auth/login', { body: { email: attacker.user.email, password: PASSWORD, clubId: victim.club.id } }), ctx);
    const token = cookieFrom(res, 'rp_session')!;
    const meBody = await json<{ club: { name: string } }>(await me(req('GET', '/api/me', { cookies: { rp_session: token } }), ctx));
    expect(meBody.club.name).toBe(attacker.club.name);
  });
});

describe('sessions', () => {
  it('logout invalidates the session server-side, not just the cookie', async () => {
    const { user } = await createClubWithUser();
    const { token } = await signIn(user.email);
    const out = await logout(req('POST', '/api/auth/logout', { cookies: { rp_session: token! } }), ctx);
    expect(out.status).toBe(200);
    expect(setCookieHeader(out, 'rp_session')).toMatch(/Max-Age=0/i);
    const replay = await me(req('GET', '/api/me', { cookies: { rp_session: token! } }), ctx);
    expect(replay.status).toBe(401);
  });

  it('rejects missing, malformed and forged tokens', async () => {
    expect((await me(req('GET', '/api/me'), ctx)).status).toBe(401);
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: 'short' } }), ctx)).status).toBe(401);
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: 'A'.repeat(43) } }), ctx)).status).toBe(401);
  });

  it('expires idle sessions', async () => {
    const { user } = await createClubWithUser();
    const { token } = await signIn(user.email);
    await owner.query(`update club_sessions s set last_seen_at = now() - interval '4 days' from club_users u where u.id = s.club_user_id and u.email = $1`, [user.email]);
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: token! } }), ctx)).status).toBe(401);
  });

  it('expires sessions at their absolute lifetime', async () => {
    const { user } = await createClubWithUser();
    const { token } = await signIn(user.email);
    await owner.query(`update club_sessions s set expires_at = now() - interval '1 second' from club_users u where u.id = s.club_user_id and u.email = $1`, [user.email]);
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: token! } }), ctx)).status).toBe(401);
  });

  it('disabling an account kills its live sessions', async () => {
    const { user } = await createClubWithUser();
    const { token } = await signIn(user.email);
    await owner.query(`update club_users set status = 'disabled' where email = $1`, [user.email]);
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: token! } }), ctx)).status).toBe(401);
  });

  it('lists only the signed-in user’s sessions and marks the current one', async () => {
    const { user } = await createClubWithUser();
    const other = await createClubWithUser();
    const first = await signIn(user.email);
    await signIn(user.email);
    await signIn(other.user.email);
    const res = await listSessions(req('GET', '/api/account/sessions', { cookies: { rp_session: first.token! } }), ctx);
    const body = await json<{ sessions: Array<{ current: boolean }> }>(res);
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.filter((s) => s.current)).toHaveLength(1);
  });

  it('cannot revoke another club’s session (IDOR) and gets the same 404 as a missing id', async () => {
    const a = await createClubWithUser();
    const b = await createClubWithUser();
    const aSession = await signIn(a.user.email);
    const bSession = await signIn(b.user.email);
    const { rows } = await owner.query(`select s.id from club_sessions s join club_users u on u.id = s.club_user_id where u.email = $1`, [b.user.email]);
    const bSessionId = rows[0].id as string;

    const attack = await revokeSession(req('DELETE', `/api/account/sessions/${bSessionId}`, { cookies: { rp_session: aSession.token! } }), idCtx(bSessionId));
    const missingId = randomUUID();
    const missing = await revokeSession(req('DELETE', `/api/account/sessions/${missingId}`, { cookies: { rp_session: aSession.token! } }), idCtx(missingId));
    expect(attack.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await json(attack)).toEqual(await json(missing));
    // B is still signed in.
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: bSession.token! } }), ctx)).status).toBe(200);
  });

  it('can revoke its own other session', async () => {
    const { user } = await createClubWithUser();
    const one = await signIn(user.email);
    const two = await signIn(user.email);
    const list = await json<{ sessions: Array<{ id: string; current: boolean }> }>(
      await listSessions(req('GET', '/api/account/sessions', { cookies: { rp_session: one.token! } }), ctx),
    );
    const target = list.sessions.find((s) => !s.current)!;
    const res = await revokeSession(req('DELETE', `/api/account/sessions/${target.id}`, { cookies: { rp_session: one.token! } }), idCtx(target.id));
    expect(res.status).toBe(200);
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: two.token! } }), ctx)).status).toBe(401);
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: one.token! } }), ctx)).status).toBe(200);
  });
});

describe('password change', () => {
  it('requires the current password, then revokes other sessions but keeps this one', async () => {
    const { user } = await createClubWithUser();
    const one = await signIn(user.email);
    const two = await signIn(user.email);
    const bad = await changePassword(
      req('POST', '/api/account/password', { cookies: { rp_session: one.token! }, body: { currentPassword: 'wrong password!', newPassword: 'a brand new passphrase' } }),
      ctx,
    );
    expect(bad.status).toBe(422);
    const good = await changePassword(
      req('POST', '/api/account/password', { cookies: { rp_session: one.token! }, body: { currentPassword: PASSWORD, newPassword: 'a brand new passphrase' } }),
      ctx,
    );
    expect(good.status).toBe(200);
    expect(await json(good)).toEqual({ revokedOtherSessions: 1 });
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: two.token! } }), ctx)).status).toBe(401);
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: one.token! } }), ctx)).status).toBe(200);
    expect((await signIn(user.email)).res.status).toBe(401);
    expect((await signIn(user.email, 'a brand new passphrase')).res.status).toBe(200);
  });

  it('enforces the password policy server-side', async () => {
    const { user } = await createClubWithUser();
    const { token } = await signIn(user.email);
    const res = await changePassword(
      req('POST', '/api/account/password', { cookies: { rp_session: token! }, body: { currentPassword: PASSWORD, newPassword: 'short' } }),
      ctx,
    );
    expect(res.status).toBe(422);
  });

  it('requires a signed-in session', async () => {
    const res = await changePassword(req('POST', '/api/account/password', { body: { currentPassword: PASSWORD, newPassword: 'whatever passphrase' } }), ctx);
    expect(res.status).toBe(401);
  });
});

describe('club sessions cannot reach admin APIs', () => {
  it('a club cookie (even renamed to the admin cookie) is rejected by admin endpoints', async () => {
    const { user } = await createClubWithUser();
    const { token } = await signIn(user.email);
    expect((await adminAudit(req('GET', '/api/admin/audit', { cookies: { rp_session: token! } }), ctx)).status).toBe(401);
    expect((await adminAudit(req('GET', '/api/admin/audit', { cookies: { rp_admin: token! } }), ctx)).status).toBe(401);
  });
});
