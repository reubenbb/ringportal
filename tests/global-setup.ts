import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { TEST_ADMIN_URL, TEST_APP_PASSWORD, TEST_APP_ROLE, TEST_DB } from './test-config';

/** Fresh database per run: migrations applied as owner, app connects as a least-privilege login role. */
export default async function setup() {
  const admin = new Client({ connectionString: TEST_ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const ownerUrl = TEST_ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);
  const pool = new Pool({ connectionString: ownerUrl });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TEST_APP_ROLE}') THEN
        CREATE ROLE ${TEST_APP_ROLE} LOGIN PASSWORD '${TEST_APP_PASSWORD}' NOBYPASSRLS IN ROLE ringportal_app;
      END IF; END $$`);
  await pool.end();
}
