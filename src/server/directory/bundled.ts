import 'server-only';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

/** SHA-256 of the cleaned England Boxing directory file shipped with the app. */
export const BUNDLED_DIRECTORY_SHA256 = 'b1bdbc73721157833f7f2351ad38506a76eab15ce03d004c5f008eb2e463b2e0';

/** Loads the bundled, cleaned directory file and refuses it if it has been altered. */
export async function loadBundledDirectory(): Promise<string> {
  const compressed = await readFile(path.join(process.cwd(), 'data', 'england-boxing-directory.csv.br'));
  const text = brotliDecompressSync(compressed).toString('utf8');
  const sha = createHash('sha256').update(text).digest('hex');
  if (sha !== BUNDLED_DIRECTORY_SHA256) throw new Error('Bundled directory file failed its integrity check');
  return text;
}
