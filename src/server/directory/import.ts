import 'server-only';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { eq, inArray } from 'drizzle-orm';
import { withAdmin } from '@/server/db/client';
import { directoryClubs, directoryImportRuns } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { parseDirectoryRow, slugify, type DirectoryRecord, type RawDirectoryRow } from './normalise';

export type ImportSummary = {
  runId: string;
  rowsTotal: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  addressConflicts: number;
  skippedReasons: Record<string, number>;
};

type Actor = { type: 'system' } | { type: 'platform_user'; id: string };

const REQUIRED_COLUMNS = ['official_id', 'name', 'source_url'];
const COMPARED: Array<keyof DirectoryRecord> = ['sourceUrl', 'name', 'region', 'membershipType', 'listedStatus', 'website', 'socialReference'];

/**
 * Imports the England Boxing club directory. Idempotent: matches on the source's
 * official id, so re-importing never creates duplicates. Every imported address
 * is unverified; an address an administrator has verified is never overwritten
 * by an import (the difference is counted and audited instead).
 */
export async function importEnglandBoxingDirectory(csvText: string, actor: Actor = { type: 'system' }): Promise<ImportSummary> {
  const rows = parse(csvText, { columns: true, bom: true, skip_empty_lines: true, trim: false, relax_column_count: false }) as RawDirectoryRow[];
  const header = Object.keys(rows[0] ?? {});
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Directory file is missing columns: ${missing.join(', ')}`);

  const fileSha256 = createHash('sha256').update(csvText).digest('hex');
  const skippedReasons: Record<string, number> = {};
  const parsed = new Map<string, DirectoryRecord>();
  for (const row of rows) {
    const r = parseDirectoryRow(row);
    if (!r.ok) {
      skippedReasons[r.reason] = (skippedReasons[r.reason] ?? 0) + 1;
      continue;
    }
    if (parsed.has(r.record.sourceRef)) {
      skippedReasons.duplicate_official_id = (skippedReasons.duplicate_official_id ?? 0) + 1;
      continue;
    }
    parsed.set(r.record.sourceRef, r.record);
  }
  const skipped = Object.values(skippedReasons).reduce((a, b) => a + b, 0);

  return withAdmin(async (tx) => {
    const [run] = await tx
      .insert(directoryImportRuns)
      .values({ source: 'england_boxing_directory', fileSha256, rowsTotal: rows.length, skipped })
      .returning({ id: directoryImportRuns.id });
    const runId = run!.id;
    const now = new Date();

    const refs = [...parsed.keys()];
    const existing = new Map<string, typeof directoryClubs.$inferSelect>();
    for (let i = 0; i < refs.length; i += 500) {
      const chunk = refs.slice(i, i + 500);
      const found = await tx.select().from(directoryClubs).where(inArray(directoryClubs.sourceRef, chunk));
      for (const f of found) if (f.source === 'england_boxing_directory') existing.set(f.sourceRef, f);
    }
    const takenSlugs = new Set((await tx.select({ slug: directoryClubs.slug }).from(directoryClubs)).map((r) => r.slug));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let addressConflicts = 0;
    const toInsert: Array<typeof directoryClubs.$inferInsert> = [];
    const unchangedIds: string[] = [];

    for (const rec of parsed.values()) {
      const prev = existing.get(rec.sourceRef);
      if (!prev) {
        let slug = slugify(rec.name);
        if (takenSlugs.has(slug)) slug = `${slug}-${rec.sourceRef.toLowerCase()}`;
        takenSlugs.add(slug);
        toInsert.push({
          source: 'england_boxing_directory',
          ...rec,
          slug,
          governingBodyId: 1,
          addressStatus: 'unverified',
          lastImportRunId: runId,
          firstImportedAt: now,
          lastImportedAt: now,
        });
        continue;
      }

      const changes: Partial<typeof directoryClubs.$inferInsert> = {};
      for (const k of COMPARED) if ((prev[k] ?? null) !== (rec[k] ?? null)) Object.assign(changes, { [k]: rec[k] });
      const addressDiffers = (prev.address ?? null) !== rec.address || (prev.postcode ?? null) !== rec.postcode;
      if (addressDiffers) {
        if (prev.addressStatus === 'verified') {
          addressConflicts++;
          await audit(tx, {
            actorType: actor.type,
            actorId: actor.type === 'platform_user' ? actor.id : null,
            action: 'directory.address_conflict',
            targetType: 'directory_club',
            targetId: prev.id,
            metadata: { runId, kept: 'verified_address' },
          });
        } else {
          Object.assign(changes, { address: rec.address, postcode: rec.postcode, addressFlag: rec.addressFlag });
        }
      } else if (prev.addressStatus === 'unverified' && prev.addressFlag !== rec.addressFlag) {
        changes.addressFlag = rec.addressFlag;
      }

      if (Object.keys(changes).length) {
        updated++;
        await tx
          .update(directoryClubs)
          .set({ ...changes, lastImportedAt: now, lastImportRunId: runId })
          .where(eq(directoryClubs.id, prev.id));
      } else {
        unchanged++;
        unchangedIds.push(prev.id);
      }
    }

    for (let i = 0; i < unchangedIds.length; i += 500) {
      await tx
        .update(directoryClubs)
        .set({ lastImportedAt: now, lastImportRunId: runId })
        .where(inArray(directoryClubs.id, unchangedIds.slice(i, i + 500)));
    }
    for (let i = 0; i < toInsert.length; i += 200) {
      const chunk = toInsert.slice(i, i + 200);
      await tx.insert(directoryClubs).values(chunk);
      inserted += chunk.length;
    }

    await tx
      .update(directoryImportRuns)
      .set({ inserted, updated, unchanged, addressConflicts, finishedAt: new Date() })
      .where(eq(directoryImportRuns.id, runId));
    await audit(tx, {
      actorType: actor.type,
      actorId: actor.type === 'platform_user' ? actor.id : null,
      action: 'directory.import_completed',
      targetType: 'directory_import_run',
      targetId: runId,
      metadata: { source: 'england_boxing_directory', fileSha256, rowsTotal: rows.length, inserted, updated, unchanged, skipped, addressConflicts, skippedReasons },
    });
    return { runId, rowsTotal: rows.length, inserted, updated, unchanged, skipped, addressConflicts, skippedReasons };
  });
}
