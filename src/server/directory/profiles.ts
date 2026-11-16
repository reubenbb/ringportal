import 'server-only';
import { and, asc, count, desc, eq, ilike, isNotNull, or, type SQL } from 'drizzle-orm';
import { withAdmin, withClub } from '@/server/db/client';
import { auditLog, directoryClubs, governingBodies, platformUsers } from '@/server/db/schema';
import type { ClubSession } from '@/server/auth/session';

const profileColumns = {
  id: directoryClubs.id,
  slug: directoryClubs.slug,
  name: directoryClubs.name,
  sourceRef: directoryClubs.sourceRef,
  sourceUrl: directoryClubs.sourceUrl,
  governingBody: governingBodies.name,
  region: directoryClubs.region,
  membershipType: directoryClubs.membershipType,
  listedStatus: directoryClubs.listedStatus,
  address: directoryClubs.address,
  postcode: directoryClubs.postcode,
  addressStatus: directoryClubs.addressStatus,
  addressFlag: directoryClubs.addressFlag,
  addressVerifiedAt: directoryClubs.addressVerifiedAt,
  website: directoryClubs.website,
  socialReference: directoryClubs.socialReference,
  claimStatus: directoryClubs.claimStatus,
  clubId: directoryClubs.clubId,
  firstImportedAt: directoryClubs.firstImportedAt,
  lastImportedAt: directoryClubs.lastImportedAt,
};

export type DirectoryProfile = {
  id: string;
  slug: string;
  name: string;
  sourceRef: string;
  sourceUrl: string;
  governingBody: string;
  region: string | null;
  membershipType: string | null;
  listedStatus: string | null;
  address: string | null;
  postcode: string | null;
  addressStatus: 'unverified' | 'verified';
  addressFlag: 'missing' | 'differs_from_map' | null;
  addressVerifiedAt: string | null;
  website: string | null;
  socialReference: string | null;
  claimStatus: 'unclaimed' | 'claimed';
  /** RingPortal club that claimed this profile, if any. */
  clubId: string | null;
  firstImportedAt: string;
  lastImportedAt: string;
};

type Row = { [K in keyof typeof profileColumns]: unknown };
function toProfile(r: Row): DirectoryProfile {
  const d = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
  return { ...(r as unknown as DirectoryProfile), addressVerifiedAt: d(r.addressVerifiedAt), firstImportedAt: d(r.firstImportedAt)!, lastImportedAt: d(r.lastImportedAt)! };
}

export type ProfileHistoryItem = { occurredAt: string; action: string; actor: string | null; reason: string | null };

/** Admin view: full record plus its audit history (verification changes, import conflicts). */
export async function getDirectoryProfileForAdmin(id: string): Promise<{ profile: DirectoryProfile; history: ProfileHistoryItem[] } | null> {
  return withAdmin(async (tx) => {
    const [row] = await tx
      .select(profileColumns)
      .from(directoryClubs)
      .innerJoin(governingBodies, eq(governingBodies.id, directoryClubs.governingBodyId))
      .where(eq(directoryClubs.id, id));
    if (!row) return null;
    const history = await tx
      .select({ occurredAt: auditLog.occurredAt, action: auditLog.action, actor: platformUsers.email, reason: auditLog.reason })
      .from(auditLog)
      .leftJoin(platformUsers, eq(platformUsers.id, auditLog.actorId))
      .where(and(eq(auditLog.targetType, 'directory_club'), eq(auditLog.targetId, id)))
      .orderBy(desc(auditLog.id))
      .limit(50);
    return {
      profile: toProfile(row),
      history: history.map((h) => ({ ...h, occurredAt: h.occurredAt.toISOString() })),
    };
  });
}

export const CLUB_PAGE_SIZE = 30;
const escapeLike = (v: string) => v.replace(/[%_\\]/g, '\\$&');

export type ClubDirectoryItem = Pick<DirectoryProfile, 'slug' | 'name' | 'region' | 'postcode' | 'address' | 'addressStatus' | 'addressFlag' | 'claimStatus'>;

/** Club view, read through the club's own RLS context (directory is read-only to clubs). */
export async function listDirectoryForClub(session: ClubSession, opts: { q?: string; region?: string; page?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const filters: SQL[] = [];
  if (opts.q) {
    const term = `%${escapeLike(opts.q)}%`;
    filters.push(or(ilike(directoryClubs.name, term), ilike(directoryClubs.postcode, term))!);
  }
  if (opts.region) filters.push(eq(directoryClubs.region, opts.region));
  const where = filters.length ? and(...filters) : undefined;
  return withClub(session.clubId, async (tx) => {
    const [total] = await tx.select({ n: count() }).from(directoryClubs).where(where);
    const rows = await tx
      .select({
        slug: directoryClubs.slug,
        name: directoryClubs.name,
        region: directoryClubs.region,
        postcode: directoryClubs.postcode,
        address: directoryClubs.address,
        addressStatus: directoryClubs.addressStatus,
        addressFlag: directoryClubs.addressFlag,
        claimStatus: directoryClubs.claimStatus,
      })
      .from(directoryClubs)
      .where(where)
      .orderBy(asc(directoryClubs.name), asc(directoryClubs.id))
      .limit(CLUB_PAGE_SIZE)
      .offset((page - 1) * CLUB_PAGE_SIZE);
    const regions = await tx
      .selectDistinct({ region: directoryClubs.region })
      .from(directoryClubs)
      .where(isNotNull(directoryClubs.region))
      .orderBy(asc(directoryClubs.region));
    return { rows: rows as ClubDirectoryItem[], total: Number(total?.n ?? 0), page, pageSize: CLUB_PAGE_SIZE, regions: regions.map((r) => r.region!) };
  });
}

export async function getDirectoryProfileForClub(session: ClubSession, slug: string): Promise<DirectoryProfile | null> {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  return withClub(session.clubId, async (tx) => {
    const [row] = await tx
      .select(profileColumns)
      .from(directoryClubs)
      .innerJoin(governingBodies, eq(governingBodies.id, directoryClubs.governingBodyId))
      .where(eq(directoryClubs.slug, slug));
    return row ? toProfile(row) : null;
  });
}

