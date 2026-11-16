import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as requestReset } from '@/app/api/auth/password-reset/request/route';
import { POST as confirmReset } from '@/app/api/auth/password-reset/confirm/route';
import { POST as login } from '@/app/api/auth/login/route';
import { GET as me } from '@/app/api/me/route';
import { POST as adminLogin } from '@/app/api/admin/auth/login/route';
import { closeDb } from '@/server/db/client';
import { outbox } from '@/server/mail';
import { PASSWORD, cookieFrom, createClubWithUser, createPlatformUser, ctx, json, owner, req } from './helpers';

afterAll(async () => {
  await closeDb();
});
beforeEach(() => {
  outbox.length = 0;
});

const NEW_PASSWORD = 'freshly minted passphrase';

function tokenFromMail(): string {
  const text = outbox.at(-1)?.text ?? '';
  const m = text.match(/#token=([A-Za-z0-9_-]+)/);
  if (!m?.[1]) throw new Error('no token in mail');
  return m[1];
}

const ask = (email: string, audience: 'club' | 'admin' = 'club', ip?: string) =>
  requestReset(req('POST', '/api/auth/password-reset/request', { body: { email, audience }, ip }), ctx);
const confirm = (token: string, password = NEW_PASSWORD) =>
  confirmReset(req('POST', '/api/auth/password-reset/confirm', { body: { token, password } }), ctx);

describe('password reset', () => {
  it('gives an identical response for known and unknown emails, and only mails real accounts', async () => {
    const { user } = await createClubWithUser();
    const known = await ask(user.email);
    const unknown = await ask('nobody-at-all@example.test');
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await json(known)).toEqual(await json(unknown));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(user.email);
  });

  it('puts the token in the URL fragment and stores only its hash', async () => {
    const { user } = await createClubWithUser();
    await ask(user.email);
    expect(outbox[0]!.text).toMatch(/\/reset-password#token=/);
    const token = tokenFromMail();
    const { rows } = await owner.query(`select encode(token_hash, 'escape') as t from password_reset_tokens`);
    expect(rows.some((r) => String(r.t).includes(token))).toBe(false);
  });

  it('resets the password, signs out every session and is single-use', async () => {
    const { user } = await createClubWithUser();
    const session = cookieFrom(await login(req('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } }), ctx), 'rp_session')!;
    await ask(user.email);
    const token = tokenFromMail();
    const res = await confirm(token);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, audience: 'club' });
    expect((await me(req('GET', '/api/me', { cookies: { rp_session: session } }), ctx)).status).toBe(401);
    expect((await login(req('POST', '/api/auth/login', { body: { email: user.email, password: NEW_PASSWORD } }), ctx)).status).toBe(200);
    expect((await confirm(token, 'another new passphrase')).status).toBe(400);
  });

  it('only the most recent link works', async () => {
    const { user } = await createClubWithUser();
    await ask(user.email);
    const first = tokenFromMail();
    await ask(user.email);
    const second = tokenFromMail();
    expect((await confirm(first)).status).toBe(400);
    expect((await confirm(second)).status).toBe(200);
  });

  it('rejects an expired link', async () => {
    const { user } = await createClubWithUser();
    await ask(user.email);
    const token = tokenFromMail();
    await owner.query(`update password_reset_tokens set expires_at = now() - interval '1 minute' where used_at is null`);
    expect((await confirm(token)).status).toBe(400);
  });

  it('enforces the password policy', async () => {
    const { user } = await createClubWithUser();
    await ask(user.email);
    expect((await confirm(tokenFromMail(), 'short')).status).toBe(422);
  });

  it('limits requests per account', async () => {
    const { user } = await createClubWithUser();
    for (let i = 0; i < 5; i++) await ask(user.email);
    expect(outbox).toHaveLength(3);
  });

  it('a club audience request never resets an admin with the same email, and vice versa', async () => {
    const admin = await createPlatformUser();
    await ask(admin.email, 'club');
    expect(outbox).toHaveLength(0);
    await ask(admin.email, 'admin');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.text).toMatch(/\/admin\/reset-password#token=/);
  });

  it('an admin reset changes the password but still requires the second factor', async () => {
    const admin = await createPlatformUser();
    await ask(admin.email, 'admin');
    expect((await confirm(tokenFromMail())).status).toBe(200);
    const res = await adminLogin(req('POST', '/api/admin/auth/login', { body: { email: admin.email, password: NEW_PASSWORD } }), ctx);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ next: 'mfa' });
    expect(cookieFrom(res, 'rp_admin')).toBeUndefined();
  });
});
