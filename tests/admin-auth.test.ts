import { afterAll, describe, expect, it } from 'vitest';
import { POST as adminLogin } from '@/app/api/admin/auth/login/route';
import { POST as adminMfa } from '@/app/api/admin/auth/mfa/route';
import { POST as enrolStart } from '@/app/api/admin/auth/enrol/start/route';
import { POST as enrolConfirm } from '@/app/api/admin/auth/enrol/confirm/route';
import { POST as adminLogout } from '@/app/api/admin/auth/logout/route';
import { GET as audit } from '@/app/api/admin/audit/route';
import { POST as regenerateCodes } from '@/app/api/admin/account/recovery-codes/route';
import { POST as rotateStart } from '@/app/api/admin/account/mfa/rotate/route';
import { POST as rotateConfirm } from '@/app/api/admin/account/mfa/confirm/route';
import { GET as clubMe } from '@/app/api/me/route';
import { generateTotp } from '@/server/auth/mfa';
import { closeDb } from '@/server/db/client';
import { PASSWORD, cookieFrom, createClubWithUser, createPlatformUser, ctx, json, owner, req, setCookieHeader, totpFor } from './helpers';

afterAll(async () => {
  await closeDb();
});

async function passwordStep(email: string, password = PASSWORD) {
  const res = await adminLogin(req('POST', '/api/admin/auth/login', { body: { email, password } }), ctx);
  return { res, challenge: cookieFrom(res, 'rp_admin_mfa') };
}

async function fullLogin(email: string, secret: string) {
  const { challenge } = await passwordStep(email);
  const res = await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: challenge! }, body: { code: totpFor(secret) } }), ctx);
  return { res, session: cookieFrom(res, 'rp_admin') };
}

const auditAs = (session?: string) => audit(req('GET', '/api/admin/audit', { cookies: session ? { rp_admin: session } : {} }), ctx);

describe('admin sign-in requires a second factor', () => {
  it('password alone issues only a short-lived strict challenge cookie, never a session', async () => {
    const admin = await createPlatformUser();
    const { res, challenge } = await passwordStep(admin.email);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ next: 'mfa' });
    expect(cookieFrom(res, 'rp_admin')).toBeUndefined();
    expect(setCookieHeader(res, 'rp_admin_mfa')).toMatch(/SameSite=strict/i);
    expect((await auditAs(challenge)).status).toBe(401);
  });

  it('a valid TOTP code completes sign-in and grants admin API access', async () => {
    const admin = await createPlatformUser();
    const { res, session } = await fullLogin(admin.email, admin.secret!);
    expect(res.status).toBe(200);
    expect(setCookieHeader(res, 'rp_admin')).toMatch(/HttpOnly/i);
    expect(setCookieHeader(res, 'rp_admin_mfa')).toMatch(/Max-Age=0/i);
    expect((await auditAs(session)).status).toBe(200);
  });

  it('rejects a replayed TOTP code', async () => {
    const admin = await createPlatformUser();
    const code = totpFor(admin.secret!);
    const first = await passwordStep(admin.email);
    expect((await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: first.challenge! }, body: { code } }), ctx)).status).toBe(200);
    const second = await passwordStep(admin.email);
    expect((await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: second.challenge! }, body: { code } }), ctx)).status).toBe(422);
  });

  it('locks the challenge after five wrong codes', async () => {
    const admin = await createPlatformUser();
    const { challenge } = await passwordStep(admin.email);
    for (let i = 0; i < 5; i++) {
      const r = await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: challenge! }, body: { code: '000000' } }), ctx);
      expect(r.status).toBe(422);
    }
    const r = await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: challenge! }, body: { code: totpFor(admin.secret!) } }), ctx);
    expect(r.status).toBe(401);
  });

  it('expires the challenge after five minutes', async () => {
    const admin = await createPlatformUser();
    const { challenge } = await passwordStep(admin.email);
    await owner.query(`update platform_mfa_challenges set expires_at = now() - interval '1 second' where platform_user_id = $1`, [admin.id]);
    const r = await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: challenge! }, body: { code: totpFor(admin.secret!) } }), ctx);
    expect(r.status).toBe(401);
  });

  it('wrong password gives the same error as an unknown admin and no challenge', async () => {
    const admin = await createPlatformUser();
    const wrong = await passwordStep(admin.email, 'definitely wrong');
    const unknown = await passwordStep('ghost-admin@example.test');
    expect(wrong.res.status).toBe(401);
    expect(await json(wrong.res)).toEqual(await json(unknown.res));
    expect(wrong.challenge).toBeUndefined();
  });

  it('a club login cannot be used as an admin login', async () => {
    const { user } = await createClubWithUser();
    expect((await passwordStep(user.email)).res.status).toBe(401);
  });

  it('an admin session is not a club session', async () => {
    const admin = await createPlatformUser();
    const { session } = await fullLogin(admin.email, admin.secret!);
    expect((await clubMe(req('GET', '/api/me', { cookies: { rp_session: session! } }), ctx)).status).toBe(401);
  });

  it('logout revokes the admin session server-side', async () => {
    const admin = await createPlatformUser();
    const { session } = await fullLogin(admin.email, admin.secret!);
    await adminLogout(req('POST', '/api/admin/auth/logout', { cookies: { rp_admin: session! } }), ctx);
    expect((await auditAs(session)).status).toBe(401);
  });

  it('idle admin sessions expire after 30 minutes', async () => {
    const admin = await createPlatformUser();
    const { session } = await fullLogin(admin.email, admin.secret!);
    await owner.query(`update platform_sessions set last_seen_at = now() - interval '31 minutes' where platform_user_id = $1`, [admin.id]);
    expect((await auditAs(session)).status).toBe(401);
  });

  it('a session row for an account whose MFA was removed is refused', async () => {
    const admin = await createPlatformUser();
    const { session } = await fullLogin(admin.email, admin.secret!);
    await owner.query(`update platform_users set mfa_enabled_at = null where id = $1`, [admin.id]);
    expect((await auditAs(session)).status).toBe(401);
  });
});

describe('first-time enrolment', () => {
  it('forces enrolment, then issues recovery codes and a session', async () => {
    const admin = await createPlatformUser({ enrolled: false });
    const { res, challenge } = await passwordStep(admin.email);
    expect(await json(res)).toEqual({ next: 'enrol' });
    const start = await enrolStart(req('POST', '/api/admin/auth/enrol/start', { cookies: { rp_admin_mfa: challenge! } }), ctx);
    const payload = await json<{ secret: string; uri: string; qrSvg: string }>(start);
    expect(payload.uri).toMatch(/^otpauth:\/\/totp\/RingPortal/);
    expect(payload.qrSvg).toMatch(/^<svg/);

    const bad = await enrolConfirm(req('POST', '/api/admin/auth/enrol/confirm', { cookies: { rp_admin_mfa: challenge! }, body: { code: '123456' } }), ctx);
    expect(bad.status).toBe(422);
    const ok = await enrolConfirm(
      req('POST', '/api/admin/auth/enrol/confirm', { cookies: { rp_admin_mfa: challenge! }, body: { code: generateTotp(payload.secret) } }),
      ctx,
    );
    expect(ok.status).toBe(200);
    const body = await json<{ recoveryCodes: string[] }>(ok);
    expect(body.recoveryCodes).toHaveLength(10);
    expect(new Set(body.recoveryCodes).size).toBe(10);
    expect((await auditAs(cookieFrom(ok, 'rp_admin'))).status).toBe(200);

    const { rows } = await owner.query(`select mfa_secret_enc, mfa_pending_secret_enc from platform_users where id = $1`, [admin.id]);
    expect(rows[0].mfa_pending_secret_enc).toBeNull();
    expect(rows[0].mfa_secret_enc).toMatch(/^v1\./);
    expect(rows[0].mfa_secret_enc).not.toContain(payload.secret);
  });

  it('an enrolled admin cannot restart enrolment to replace their factor', async () => {
    const admin = await createPlatformUser();
    const { challenge } = await passwordStep(admin.email);
    const r = await enrolStart(req('POST', '/api/admin/auth/enrol/start', { cookies: { rp_admin_mfa: challenge! } }), ctx);
    expect(r.status).toBe(401);
  });
});

describe('recovery codes and factor rotation', () => {
  async function enrolledSession() {
    const admin = await createPlatformUser();
    const { session } = await fullLogin(admin.email, admin.secret!);
    return { admin, session: session! };
  }

  it('regenerating codes needs a fresh TOTP; each recovery code works exactly once', async () => {
    const { admin, session } = await enrolledSession();
    const denied = await regenerateCodes(req('POST', '/api/admin/account/recovery-codes', { cookies: { rp_admin: session }, body: { code: '000000' } }), ctx);
    expect(denied.status).toBe(422);
    const res = await regenerateCodes(
      req('POST', '/api/admin/account/recovery-codes', { cookies: { rp_admin: session }, body: { code: totpFor(admin.secret!, 1) } }),
      ctx,
    );
    const { recoveryCodes } = await json<{ recoveryCodes: string[] }>(res);
    const code = recoveryCodes[0]!;

    const a = await passwordStep(admin.email);
    const used = await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: a.challenge! }, body: { recoveryCode: code.toUpperCase().replace(/-/g, ' ') } }), ctx);
    expect(used.status).toBe(200);
    const b = await passwordStep(admin.email);
    const reused = await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: b.challenge! }, body: { recoveryCode: code } }), ctx);
    expect(reused.status).toBe(422);
    const { rows } = await owner.query(`select metadata from audit_log where actor_id = $1 and action = 'admin.login' order by id desc limit 1`, [admin.id]);
    expect(rows[0].metadata).toMatchObject({ method: 'recovery_code', recoveryCodesRemaining: 9 });
  });

  it('rotation needs the current factor, then the new one, and signs out other sessions', async () => {
    const { admin, session } = await enrolledSession();
    // Test setup only: allow the same time-step again so a second device can sign in within this test.
    await owner.query(`update platform_users set mfa_last_step = null where id = $1`, [admin.id]);
    const other = await fullLogin(admin.email, admin.secret!);
    expect(other.session).toBeTruthy();
    await owner.query(`update platform_users set mfa_last_step = null where id = $1`, [admin.id]);
    const start = await rotateStart(req('POST', '/api/admin/account/mfa/rotate', { cookies: { rp_admin: session }, body: { code: totpFor(admin.secret!, 1) } }), ctx);
    expect(start.status).toBe(200);
    const { secret: newSecret } = await json<{ secret: string }>(start);
    const confirm = await rotateConfirm(req('POST', '/api/admin/account/mfa/confirm', { cookies: { rp_admin: session }, body: { code: generateTotp(newSecret) } }), ctx);
    expect(confirm.status).toBe(200);
    expect(await json(confirm)).toEqual({ revokedOtherSessions: 1 });
    expect((await auditAs(other.session)).status).toBe(401);
    expect((await auditAs(session)).status).toBe(200);

    // Old factor no longer works; new one does.
    const p = await passwordStep(admin.email);
    expect((await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: p.challenge! }, body: { code: totpFor(admin.secret!, -1) } }), ctx)).status).toBe(422);
    const q = await passwordStep(admin.email);
    expect((await adminMfa(req('POST', '/api/admin/auth/mfa', { cookies: { rp_admin_mfa: q.challenge! }, body: { code: generateTotp(newSecret, Date.now() + 30_000) } }), ctx)).status).toBe(200);
  });
});

describe('audit log API', () => {
  it('requires an admin session and paginates', async () => {
    expect((await auditAs()).status).toBe(401);
    const admin = await createPlatformUser();
    const { session } = await fullLogin(admin.email, admin.secret!);
    const page = await json<{ rows: Array<{ id: number }>; nextBefore: number | null }>(
      await audit(req('GET', '/api/admin/audit?limit=2', { cookies: { rp_admin: session! } }), ctx),
    );
    expect(page.rows).toHaveLength(2);
    expect(page.nextBefore).toBe(page.rows[1]!.id);
    const next = await json<{ rows: Array<{ id: number }> }>(
      await audit(req('GET', `/api/admin/audit?limit=2&before=${page.nextBefore}`, { cookies: { rp_admin: session! } }), ctx),
    );
    expect(next.rows[0]!.id).toBeLessThan(page.nextBefore!);
  });

  it('rejects injection-shaped filters', async () => {
    const admin = await createPlatformUser();
    const { session } = await fullLogin(admin.email, admin.secret!);
    const r = await audit(req('GET', `/api/admin/audit?action=${encodeURIComponent("x' or 1=1--")}`, { cookies: { rp_admin: session! } }), ctx);
    expect(r.status).toBe(400);
  });
});
