/**
 * Applies pending migrations using the owner role (DATABASE_MIGRATION_URL).
 * Run: npm run db:migrate
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  console.error('DATABASE_MIGRATION_URL is not set');
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  console.log('Migrations applied.');
} finally {
  await pool.end();
}
