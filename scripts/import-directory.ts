/**
 * Imports the England Boxing club directory (cleaned CSV) into the database.
 *   npm run directory:import -- --file data/england-boxing-directory.csv
 * Idempotent; safe to re-run. Addresses are imported as unverified.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { closeDb } from '@/server/db/client';
import { importEnglandBoxingDirectory } from '@/server/directory/import';

const { values } = parseArgs({ options: { file: { type: 'string', default: 'data/england-boxing-directory.csv' } } });

try {
  const summary = await importEnglandBoxingDirectory(await readFile(values.file!, 'utf8'));
  console.log(JSON.stringify(summary, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
