import { afterAll, describe, expect, it } from 'vitest';
import { GET as health } from '@/app/api/health/route';
import { closeDb, strictSsl } from '@/server/db/client';
import { ctx, json, req } from './helpers';

afterAll(async () => {
  await closeDb();
});

describe('health check', () => {
  it('reports the database as reachable, with no sign-in and nothing sensitive', async () => {
    const res = await health(req('GET', '/api/health'), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await json<Record<string, unknown>>(res);
    expect(body).toMatchObject({ status: 'ok', database: 'ok' });
    expect(Object.keys(body).sort()).toEqual(['commit', 'database', 'ms', 'status']);
  });
});


describe('database connection string', () => {
  it('upgrades weaker sslmode values to verify-full and leaves others alone', () => {
    expect(strictSsl('postgresql://u:p@h/db?sslmode=require&channel_binding=require')).toBe('postgresql://u:p@h/db?sslmode=verify-full&channel_binding=require');
    expect(strictSsl('postgresql://u:p@h/db?x=1&sslmode=prefer')).toBe('postgresql://u:p@h/db?x=1&sslmode=verify-full');
    expect(strictSsl('postgresql://u:p@h/db?sslmode=verify-full')).toBe('postgresql://u:p@h/db?sslmode=verify-full');
    expect(strictSsl('postgresql://u:p@127.0.0.1:5432/db')).toBe('postgresql://u:p@127.0.0.1:5432/db');
    expect(strictSsl('postgresql://u:p@h/db?sslmode=disable')).toBe('postgresql://u:p@h/db?sslmode=disable');
  });
});
