import 'server-only';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { env } from '@/server/env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type Holder = { pool: Pool; db: Db };
const globalForDb = globalThis as unknown as { __ringportalDb?: Holder };

/**
 * The pg driver currently treats sslmode=require as full certificate verification, and has announced
 * that a future major version will weaken it. Ask for verify-full explicitly so the behaviour cannot
 * change under us. URLs without an sslmode (local development) are left alone.
 */
export function strictSsl(url: string): string {
  return url.replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, '$1verify-full');
}

function holder(): Holder {
  if (!globalForDb.__ringportalDb) {
    const pool = new Pool({
      connectionString: strictSsl(env().DATABASE_URL),
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => console.error('[db] idle client error', { message: err.message }));
    globalForDb.__ringportalDb = { pool, db: drizzle(pool, { schema }) };
  }
  return globalForDb.__ringportalDb;
}

/**
 * Every database access goes through one of these wrappers. Each runs in a
 * single transaction with a request context that row-level security enforces.
 * There is deliberately no unscoped export.
 */
export type ClubContext = { kind: 'club'; clubId: string };
export type AdminContext = { kind: 'admin' };
/** Pre-authentication work: login, session lookup, password reset. */
export type AuthContext = { kind: 'auth' };
export type DbContext = ClubContext | AdminContext | AuthContext;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (ctx.kind === 'club' && !UUID_RE.test(ctx.clubId)) throw new Error('Invalid club context');
  return holder().db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.context', ${ctx.kind}, true)`);
    await tx.execute(sql`select set_config('app.club_id', ${ctx.kind === 'club' ? ctx.clubId : ''}, true)`);
    return fn(tx);
  });
}

export const withClub = <T>(clubId: string, fn: (tx: Tx) => Promise<T>) => withContext({ kind: 'club', clubId }, fn);
export const withAdmin = <T>(fn: (tx: Tx) => Promise<T>) => withContext({ kind: 'admin' }, fn);
export const withAuth = <T>(fn: (tx: Tx) => Promise<T>) => withContext({ kind: 'auth' }, fn);

/** Test/maintenance hook. */
export async function closeDb(): Promise<void> {
  const h = globalForDb.__ringportalDb;
  globalForDb.__ringportalDb = undefined;
  if (h) await h.pool.end();
}
