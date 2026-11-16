import 'server-only';
import { sql } from 'drizzle-orm';
import type { Tx } from '@/server/db/client';
import { pseudonymise } from './crypto';

export type Limit = { name: string; max: number; windowSeconds: number };

export const LIMITS = {
  clubLoginIp: { name: 'club-login-ip', max: 30, windowSeconds: 900 },
  clubLoginAccount: { name: 'club-login-acct', max: 8, windowSeconds: 900 },
  adminLoginIp: { name: 'admin-login-ip', max: 10, windowSeconds: 900 },
  adminLoginAccount: { name: 'admin-login-acct', max: 5, windowSeconds: 900 },
  adminMfaIp: { name: 'admin-mfa-ip', max: 15, windowSeconds: 900 },
  resetRequestIp: { name: 'reset-req-ip', max: 5, windowSeconds: 3600 },
  resetRequestAccount: { name: 'reset-req-acct', max: 3, windowSeconds: 3600 },
  resetConfirmIp: { name: 'reset-confirm-ip', max: 10, windowSeconds: 3600 },
  passwordChange: { name: 'password-change', max: 5, windowSeconds: 900 },
  sensitiveAction: { name: 'sensitive', max: 30, windowSeconds: 900 },
} satisfies Record<string, Limit>;

export type RateResult = { allowed: boolean; retryAfterSeconds: number };

/**
 * Fixed-window counter in Postgres, shared by every serverless instance.
 * Subjects are pseudonymised so raw IPs and emails are never stored.
 */
export async function hit(tx: Tx, limit: Limit, subject: string): Promise<RateResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const windowStartSec = nowSec - (nowSec % limit.windowSeconds);
  const bucket = `${limit.name}:${pseudonymise(subject)}`;
  const res = await tx.execute<{ hits: number }>(sql`
    insert into rate_limits (bucket, window_start, hits)
    values (${bucket}, to_timestamp(${windowStartSec}), 1)
    on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
    returning hits`);
  const hits = Number(res.rows[0]?.hits ?? 0);
  if (Math.random() < 0.02) {
    await tx.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
  }
  return { allowed: hits <= limit.max, retryAfterSeconds: windowStartSec + limit.windowSeconds - nowSec };
}

export async function hitAll(tx: Tx, checks: Array<[Limit, string]>): Promise<RateResult> {
  let worst: RateResult = { allowed: true, retryAfterSeconds: 0 };
  for (const [limit, subject] of checks) {
    const r = await hit(tx, limit, subject);
    if (!r.allowed && (worst.allowed || r.retryAfterSeconds > worst.retryAfterSeconds)) worst = r;
  }
  return worst;
}
