import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { LEGAL_VERSION } from '@/lib/legal';
import { withAuth } from '@/server/db/client';
import { clubClaims, clubUsers, clubs, directoryClubs } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { emailSchema, hashPassword, passwordSchema } from '@/server/auth/password';
import { LIMITS, hit } from '@/server/auth/rate-limit';
import { createClubSession } from '@/server/auth/session';
import { isUniqueViolation } from '@/server/cross-club';
import { ENGLAND_BOXING_ID } from '@/lib/governing-body';

type Meta = { ipHash: string; userAgent: string | null };

export const registerSchema = z.object({
  clubName: z.string().trim().min(2, 'Enter your club’s name').max(160),
  affiliationNumber: z
    .string()
    .trim()
    .max(40, 'Use 40 characters or fewer')
    .regex(/^[A-Za-z0-9 ./-]*$/, 'Use letters, numbers, spaces, dots, slashes or hyphens')
    .optional()
    .transform((v) => v || null),
  directoryClubId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => v || null)
    .pipe(z.uuid({ error: 'Choose a club from the list' }).nullable()),
  region: z.string().trim().max(80).optional().nullable().transform((v) => v || null),
  email: emailSchema,
  password: passwordSchema,
  authorised: z.literal(true, { error: 'Confirm that you are authorised to register this club' }),
  acceptTerms: z.literal(true, { error: 'Accept the terms of use and privacy notice to register' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

function slugify(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'club';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

const fail = (fields: Record<string, string>) => new ApiError('validation_failed', 'Check the highlighted fields', fields);

/**
 * Self-registration, for England Boxing clubs only. Creates the club as "submitted" (no verified features until an
 * administrator approves it), its shared login, and an optional pending directory claim.
 */
export async function registerClub(input: RegisterInput, meta: Meta): Promise<string> {
  const limited = await withAuth(async (tx) => {
    const r = await hit(tx, LIMITS.registerIp, meta.ipHash);
    if (!r.allowed) await audit(tx, { actorType: 'anonymous', action: 'club.register_rate_limited', ipHash: meta.ipHash });
    return r;
  });
  if (!limited.allowed) throw new ApiError('rate_limited', 'Too many registrations from this connection. Try again later.', undefined, limited.retryAfterSeconds);

  const passwordHash = await hashPassword(input.password);
  try {
    return await withAuth(async (tx) => {
      const [existingUser] = await tx.select({ id: clubUsers.id }).from(clubUsers).where(eq(clubUsers.email, input.email));
      if (existingUser) throw fail({ email: 'This email already has a RingPortal login. Sign in or reset your password.' });

      if (input.affiliationNumber) {
        const [dupe] = await tx
          .select({ id: clubs.id })
          .from(clubs)
          .where(and(eq(clubs.governingBodyId, ENGLAND_BOXING_ID), sql`lower(${clubs.affiliationNumber}) = lower(${input.affiliationNumber})`));
        if (dupe) throw fail({ affiliationNumber: 'A club with this affiliation number is already registered. If that is your club, ask your club’s account holder for the login.' });
      }

      let region = input.region;
      if (region) {
        const [known] = await tx.select({ id: directoryClubs.id }).from(directoryClubs).where(eq(directoryClubs.region, region)).limit(1);
        if (!known) throw fail({ region: 'Choose a region from the list' });
      }
      if (input.directoryClubId) {
        const [d] = await tx
          .select({ id: directoryClubs.id, claimStatus: directoryClubs.claimStatus, governingBodyId: directoryClubs.governingBodyId, region: directoryClubs.region })
          .from(directoryClubs)
          .where(eq(directoryClubs.id, input.directoryClubId));
        if (!d) throw fail({ directoryClubId: 'Choose a club from the list' });
        if (d.governingBodyId !== ENGLAND_BOXING_ID) throw fail({ directoryClubId: 'Only England Boxing directory records can be claimed' });
        const [live] = await tx
          .select({ id: clubClaims.id })
          .from(clubClaims)
          .where(and(eq(clubClaims.directoryClubId, d.id), inArray(clubClaims.status, ['pending', 'approved'])));
        if (d.claimStatus !== 'unclaimed' || live) throw fail({ directoryClubId: 'This club has already been claimed or has a claim waiting for review' });
        // A claimed directory record's region takes precedence over the one typed in.
        region = d.region ?? region;
      }

      const [club] = await tx
        .insert(clubs)
        .values({ name: input.clubName, slug: slugify(input.clubName), governingBodyId: ENGLAND_BOXING_ID, affiliationNumber: input.affiliationNumber, region, status: 'submitted' })
        .returning({ id: clubs.id });
      const [user] = await tx.insert(clubUsers).values({ clubId: club!.id, email: input.email, passwordHash }).returning({ id: clubUsers.id });
      if (input.directoryClubId) await tx.insert(clubClaims).values({ clubId: club!.id, directoryClubId: input.directoryClubId });
      await audit(tx, {
        actorType: 'club_user',
        actorId: user!.id,
        clubId: club!.id,
        action: 'club.registered',
        targetType: 'club',
        targetId: club!.id,
        metadata: { claim: Boolean(input.directoryClubId), legalVersion: LEGAL_VERSION },
        ipHash: meta.ipHash,
      });
      return createClubSession(tx, { clubUserId: user!.id, clubId: club!.id, ...meta });
    });
  } catch (err) {
    // Races between the checks above and the inserts.
    if (isUniqueViolation(err, 'club_users_email_unique')) throw fail({ email: 'This email already has a RingPortal login. Sign in or reset your password.' });
    if (isUniqueViolation(err, 'clubs_affiliation_uq')) throw fail({ affiliationNumber: 'A club with this affiliation number is already registered.' });
    if (isUniqueViolation(err, 'club_claims_directory_live_uq')) throw fail({ directoryClubId: 'This club has already been claimed or has a claim waiting for review' });
    throw err;
  }
}

export type ClaimableClub = { id: string; name: string; region: string | null };

/** Unclaimed directory records matching a name, for the registration form. Names and regions only. */
export async function searchClaimable(q: string, meta: { ipHash: string }): Promise<ClaimableClub[]> {
  return withAuth(async (tx) => {
    const r = await hit(tx, LIMITS.registerLookupIp, meta.ipHash);
    if (!r.allowed) return [];
    const res = await tx.execute<ClaimableClub>(sql`select id, name, region from claimable_directory_clubs(${q}, 10)`);
    return res.rows;
  });
}


export async function listRegionsPublic(): Promise<string[]> {
  return withAuth(async (tx) => {
    const rows = await tx.selectDistinct({ region: directoryClubs.region }).from(directoryClubs).where(sql`${directoryClubs.region} is not null`).orderBy(directoryClubs.region);
    return rows.map((r) => r.region!);
  });
}
