import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createClubWithUser, createPlatformUser, owner } from './helpers';
import { TEST_APP_URL } from './test-config';

/**
 * Database-level tenant isolation, exercised as the real application login role.
 * These are adversarial: they assume an application bug has already happened
 * (a missing WHERE clause) and check the database still refuses.
 */
describe('row-level security as the application role', () => {
  const app = new Client({ connectionString: TEST_APP_URL });
  let a: Awaited<ReturnType<typeof createClubWithUser>>;
  let b: Awaited<ReturnType<typeof createClubWithUser>>;

  async function inContext<T>(context: string, clubId: string, fn: () => Promise<T>): Promise<T> {
    await app.query('begin');
    try {
      await app.query(`select set_config('app.context', $1, true), set_config('app.club_id', $2, true)`, [context, clubId]);
      return await fn();
    } finally {
      await app.query('rollback');
    }
  }

  beforeAll(async () => {
    await app.connect();
    a = await createClubWithUser();
    b = await createClubWithUser();
    await createPlatformUser();
  });
  afterAll(async () => {
    await app.end();
  });

  it('app role cannot bypass RLS, is not superuser and owns nothing', async () => {
    const { rows } = await app.query(`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user`);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
    const owned = await app.query(`select count(*)::int as n from pg_tables where tableowner = current_user`);
    expect(owned.rows[0].n).toBe(0);
  });

  it('cannot run DDL', async () => {
    await expect(app.query('create table rp_evil (id int)')).rejects.toThrow(/permission denied/);
    await expect(app.query('alter table clubs disable row level security')).rejects.toThrow(/must be owner/);
  });

  it('sees nothing without a request context', async () => {
    for (const table of ['clubs', 'club_users', 'club_sessions', 'platform_users', 'password_reset_tokens', 'audit_log']) {
      const { rows } = await app.query(`select count(*)::int as n from ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });

  it('club context sees only its own club and users', async () => {
    await inContext('club', a.club.id, async () => {
      const clubs = await app.query('select id from clubs');
      expect(clubs.rows.map((r) => r.id)).toEqual([a.club.id]);
      const users = await app.query('select club_id from club_users');
      expect(new Set(users.rows.map((r) => r.club_id))).toEqual(new Set([a.club.id]));
      const other = await app.query('select * from club_users where club_id = $1', [b.club.id]);
      expect(other.rowCount).toBe(0);
    });
  });

  it('club context cannot modify another club', async () => {
    await inContext('club', a.club.id, async () => {
      const upd = await app.query(`update club_users set email = 'pwned@example.test' where club_id = $1`, [b.club.id]);
      expect(upd.rowCount).toBe(0);
      await expect(app.query(`update clubs set status = 'approved' where id = $1`, [a.club.id])).resolves.toMatchObject({ rowCount: 0 });
    });
    const { rows } = await owner.query('select email from club_users where id = $1', [b.user.id]);
    expect(rows[0].email).toBe(b.user.email);
  });

  it('club context cannot move its own user into another club', async () => {
    await inContext('club', a.club.id, async () => {
      await expect(app.query('update club_users set club_id = $1 where id = $2', [b.club.id, a.user.id])).rejects.toThrow(/row-level security/);
    });
  });

  it('club context cannot read platform or reset tables', async () => {
    await inContext('club', a.club.id, async () => {
      for (const table of ['platform_users', 'platform_sessions', 'platform_recovery_codes', 'platform_mfa_challenges', 'password_reset_tokens']) {
        const { rows } = await app.query(`select count(*)::int as n from ${table}`);
        expect(rows[0].n, table).toBe(0);
      }
    });
  });

  it('club context cannot forge audit entries for another club', async () => {
    await inContext('club', a.club.id, async () => {
      await expect(
        app.query(`insert into audit_log (actor_type, club_id, action) values ('club_user', $1, 'forged')`, [b.club.id]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('audit log is append-only, even for the owner role', async () => {
    await inContext('admin', '', async () => {
      await app.query(`insert into audit_log (actor_type, action) values ('system', 'test.append')`);
      await expect(app.query(`update audit_log set action = 'tampered'`)).rejects.toThrow(/permission denied/);
    });
    await owner.query(`insert into audit_log (actor_type, action) values ('system', 'test.owner_row')`);
    await expect(owner.query(`update audit_log set action = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(owner.query(`delete from audit_log`)).rejects.toThrow(/append-only/);
  });

  it('rejects a malformed club id in context rather than widening access', async () => {
    await app.query('begin');
    await app.query(`select set_config('app.context', 'club', true), set_config('app.club_id', 'not-a-uuid', true)`);
    await expect(app.query('select * from clubs')).rejects.toThrow(/invalid input syntax for type uuid/);
    await app.query('rollback');
  });

  it('an unknown context value grants nothing', async () => {
    await inContext('superuser', a.club.id, async () => {
      const { rows } = await app.query('select count(*)::int as n from clubs');
      expect(rows[0].n).toBe(0);
    });
  });
});
