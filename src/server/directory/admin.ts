import 'server-only';
import { and, asc, count, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { withAdmin } from '@/server/db/client';
import { directoryClubs, directoryImportRuns } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import type { AdminSession } from '@/server/auth/session';

export const PAGE_SIZE = 50;
export type AddressFilter = 'all' | 'unverified' | 'verified' | 'flagged' | 'missing';

export type DirectoryListItem = {
  id: string;
  name: string;
  region: string | null;
  address: string | null;
  postcode: string | null;
  addressStatus: 'unverified' | 'verified';
  addressFlag: 'missing' | 'differs_from_map' | null;
  claimStatus: 'unclaimed' | 'claimed';
  sourceRef: string;
  website: string | null;
};

const escapeLike = (v: string) => v.replace(/[%_\\]/g, '\\$&');

export async function listDirectory(opts: { q?: string; region?: string; address?: AddressFilter; page?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const filters: SQL[] = [];
  if (opts.q) {
    const term = `%${escapeLike(opts.q)}%`;
    filters.push(or(ilike(directoryClubs.name, term), ilike(directoryClubs.postcode, term), eq(directoryClubs.sourceRef, opts.q))!);
  }
  if (opts.region) filters.push(eq(directoryClubs.region, opts.region));
  if (opts.address === 'unverified') filters.push(eq(directoryClubs.addressStatus, 'unverified'));
  if (opts.address === 'verified') filters.push(eq(directoryClubs.addressStatus, 'verified'));
  if (opts.address === 'flagged') filters.push(and(eq(directoryClubs.addressFlag, 'differs_from_map'), eq(directoryClubs.addressStatus, 'unverified'))!);
  if (opts.address === 'missing') filters.push(eq(directoryClubs.addressFlag, 'missing'));
  const where = filters.length ? and(...filters) : undefined;

  return withAdmin(async (tx) => {
    const [total] = await tx.select({ n: count() }).from(directoryClubs).where(where);
    const rows = await tx
      .select({
        id: directoryClubs.id,
        name: directoryClubs.name,
        region: directoryClubs.region,
        address: directoryClubs.address,
        postcode: directoryClubs.postcode,
        addressStatus: directoryClubs.addressStatus,
        addressFlag: directoryClubs.addressFlag,
        claimStatus: directoryClubs.claimStatus,
        sourceRef: directoryClubs.sourceRef,
        website: directoryClubs.website,
      })
      .from(directoryClubs)
      .where(where)
      .orderBy(asc(directoryClubs.name), asc(directoryClubs.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const regions = await tx
      .selectDistinct({ region: directoryClubs.region })
      .from(directoryClubs)
      .where(isNotNull(directoryClubs.region))
      .orderBy(asc(directoryClubs.region));
    return { rows: rows as DirectoryListItem[], total: Number(total?.n ?? 0), page, pageSize: PAGE_SIZE, regions: regions.map((r) => r.region!) };
  });
}

export async function directorySummary() {
  return withAdmin(async (tx) => {
    const [row] = await tx
      .select({
        total: count(),
        verified: sql<number>`count(*) filter (where ${directoryClubs.addressStatus} = 'verified')`,
        unverified: sql<number>`count(*) filter (where ${directoryClubs.addressStatus} = 'unverified' and ${directoryClubs.address} is not null)`,
        missing: sql<number>`count(*) filter (where ${directoryClubs.addressFlag} = 'missing')`,
        flagged: sql<number>`count(*) filter (where ${directoryClubs.addressFlag} = 'differs_from_map' and ${directoryClubs.addressStatus} = 'unverified')`,
        claimed: sql<number>`count(*) filter (where ${directoryClubs.claimStatus} = 'claimed')`,
      })
      .from(directoryClubs);
    const [lastRun] = await tx.select().from(directoryImportRuns).orderBy(sql`${directoryImportRuns.startedAt} desc`).limit(1);
    return {
      total: Number(row?.total ?? 0),
      verified: Number(row?.verified ?? 0),
      unverified: Number(row?.unverified ?? 0),
      missing: Number(row?.missing ?? 0),
      flagged: Number(row?.flagged ?? 0),
      claimed: Number(row?.claimed ?? 0),
      lastImport: lastRun ? { finishedAt: lastRun.finishedAt?.toISOString() ?? null, inserted: lastRun.inserted, updated: lastRun.updated, unchanged: lastRun.unchanged, skipped: lastRun.skipped } : null,
    };
  });
}

/** Marks an address verified (after an administrator has checked it) or returns it to unverified. Always audited with a note. */
export async function setAddressStatus(admin: AdminSession, id: string, input: { action: 'verify' | 'unverify'; note: string }, meta: { ipHash: string }) {
  const result = await withAdmin(async (tx) => {
    const [row] = await tx.select({ id: directoryClubs.id, address: directoryClubs.address, status: directoryClubs.addressStatus }).from(directoryClubs).where(eq(directoryClubs.id, id)).for('update');
    if (!row) return 'not_found' as const;
    if (input.action === 'verify') {
      if (!row.address) return 'no_address' as const;
      if (row.status === 'verified') return 'ok' as const;
      await tx
        .update(directoryClubs)
        .set({ addressStatus: 'verified', addressVerifiedAt: new Date(), addressVerifiedBy: admin.platformUserId, addressFlag: null })
        .where(eq(directoryClubs.id, id));
    } else {
      if (row.status === 'unverified') return 'ok' as const;
      await tx.update(directoryClubs).set({ addressStatus: 'unverified', addressVerifiedAt: null, addressVerifiedBy: null }).where(eq(directoryClubs.id, id));
    }
    await audit(tx, {
      actorType: 'platform_user',
      actorId: admin.platformUserId,
      action: input.action === 'verify' ? 'directory.address_verified' : 'directory.address_unverified',
      targetType: 'directory_club',
      targetId: id,
      reason: input.note,
      ipHash: meta.ipHash,
    });
    return 'ok' as const;
  });
  if (result === 'not_found') throw new ApiError('not_found', 'Directory club not found');
  if (result === 'no_address') throw new ApiError('conflict', 'There is no address to verify for this club');
}
