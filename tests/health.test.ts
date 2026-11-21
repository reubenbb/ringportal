import { afterAll, describe, expect, it } from 'vitest';
import { GET as health } from '@/app/api/health/route';
import { closeDb } from '@/server/db/client';
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
