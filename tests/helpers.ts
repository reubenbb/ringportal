import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, type NextResponse } from 'next/server';
import { Pool } from 'pg';
import { hashPassword } from '@/server/auth/password';
import { newTotpSecret, sealTotpSecret, generateTotp } from '@/server/auth/mfa';
import { TEST_ORIGIN, TEST_OWNER_URL } from './test-config';

/** Owner (superuser) connection for fixtures and assertions only; bypasses RLS. Never used by the app. */
export const owner = new Pool({ connectionString: TEST_OWNER_URL, max: 2 });

export const uid = () => randomBytes(4).toString('hex');
export const randomIp = () => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
export const PASSWORD = 'correct horse battery staple';

export async function createClub(opts: { name?: string; status?: string; isDemo?: boolean } = {}) {
  const name = opts.name ?? `Test Club ${uid()}`;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${uid()}`;
  const { rows } = await owner.query<{ id: string }>(
    `insert into clubs (name, slug, governing_body_id, status, is_demo) values ($1, $2, 1, $3, $4) returning id`,
    [name, slug, opts.status ?? 'approved', opts.isDemo ?? false],
  );
  return { id: rows[0]!.id, name, slug };
}

export async function createClubUser(clubId: string, opts: { email?: string; password?: string; status?: string } = {}) {
  const email = opts.email ?? `club-${uid()}@example.test`;
  const password = opts.password ?? PASSWORD;
  const { rows } = await owner.query<{ id: string }>(
    `insert into club_users (club_id, email, password_hash, status) values ($1, $2, $3, $4) returning id`,
    [clubId, email, await hashPassword(password), opts.status ?? 'active'],
  );
  return { id: rows[0]!.id, email, password };
}

export async function createClubWithUser(opts: { status?: string } = {}) {
  const club = await createClub({ status: opts.status });
  const user = await createClubUser(club.id);
  return { club, user };
}

export async function createPlatformUser(opts: { role?: 'owner' | 'admin'; enrolled?: boolean } = {}) {
  const email = `admin-${uid()}@example.test`;
  const { rows } = await owner.query<{ id: string }>(
    `insert into platform_users (email, display_name, password_hash, role) values ($1, 'Test Admin', $2, $3) returning id`,
    [email, await hashPassword(PASSWORD), opts.role ?? 'admin'],
  );
  const id = rows[0]!.id;
  let secret: string | undefined;
  if (opts.enrolled !== false) {
    secret = newTotpSecret();
    await owner.query(`update platform_users set mfa_secret_enc = $2, mfa_enabled_at = now() where id = $1`, [id, sealTotpSecret(id, secret)]);
  }
  return { id, email, password: PASSWORD, secret };
}

/** A TOTP code for the next time-step, so it is not rejected as a replay of a code used moments earlier. */
export function totpFor(secret: string, stepOffset = 0): string {
  return generateTotp(secret, Date.now() + stepOffset * 30_000);
}

type ReqOpts = {
  body?: unknown;
  cookies?: Record<string, string>;
  origin?: string | null;
  headers?: Record<string, string>;
  ip?: string;
  rawBody?: string;
};

export function req(method: string, path: string, opts: ReqOpts = {}): NextRequest {
  const headers = new Headers(opts.headers);
  headers.set('x-forwarded-for', opts.ip ?? randomIp());
  headers.set('user-agent', 'vitest');
  if (opts.origin !== null && method !== 'GET') headers.set('origin', opts.origin ?? TEST_ORIGIN);
  if (opts.body !== undefined || opts.rawBody !== undefined) headers.set('content-type', headers.get('content-type') ?? 'application/json');
  if (opts.cookies) headers.set('cookie', Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; '));
  return new NextRequest(new URL(path, TEST_ORIGIN), {
    method,
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
}

export function cookieFrom(res: NextResponse, name: string): string | undefined {
  return res.cookies.get(name)?.value || undefined;
}

export function setCookieHeader(res: NextResponse, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export const ctx = { params: Promise.resolve({}) };
export const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
export { randomUUID };

/** Fixture boxer inserted directly (owner connection), with its private row and first availability entry. */
export async function createBoxer(
  clubId: string,
  opts: { firstName?: string; lastName?: string; sex?: 'male' | 'female'; dob?: string; weightKg?: number; availability?: string; archived?: boolean } = {},
) {
  const { rows } = await owner.query<{ id: string }>(
    `insert into boxers (club_id, first_name, last_name, sex, weight_kg, availability, archived_at)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [clubId, opts.firstName ?? 'Test', opts.lastName ?? `Boxer${uid()}`, opts.sex ?? 'male', opts.weightKg ?? 64, opts.availability ?? 'ready', opts.archived ? new Date() : null],
  );
  const id = rows[0]!.id;
  await owner.query(`insert into boxer_private (boxer_id, club_id, date_of_birth) values ($1, $2, $3)`, [id, clubId, opts.dob ?? '2000-01-01']);
  return id;
}

export function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
