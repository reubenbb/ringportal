import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAuth } from '@/server/db/client';
import { clubClaims, clubUsers, clubs, directoryClubs, governingBodies } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { emailSchema, hashPassword, passwordSchema } from '@/server/auth/password';
import { LIMITS, hit } from '@/server/auth/rate-limit';
import { createClubSession } from '@/server/auth/session';
import { isUniqueViolation } from '@/server/cross-club';

type Meta = { ipHash: string; userAgent: string | null };

export const registerSchema = z.object({
  clubName: z.string().trim().min(2, 'Enter your club’s name').max(160),
  governingBodyId: z.coerce.number({ error: 'Choose your governing body' }).int().min(1, 'Choose your governing body').max(32767),
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
  email: emailSchema,
  password: passwordSchema,
  authorised: z.literal(true, { error: 'Confirm that you are authorised to register this club' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

function slugify(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '') || 'club';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

const fail = (fields: Record<string, string>) => new ApiError('validation_failed', 'Check the highlighted fields', fields);

/**
 * Self-registration. Creates the club as "submitted" (no verified features until an
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
      const [body] = await tx.select({ id: governingBodies.id }).from(governingBodies).where(eq(governingBodies.id, input.governingBodyId));
      if (!body) throw fail({ governingBodyId: 'Choose your governing body' });

      const [existingUser] = await tx.select({ id: clubUsers.id }).from(clubUsers).where(eq(clubUsers.email, input.email));
      if (existingUser) throw fail({ email: 'This email already has a RingPortal login. Sign in or reset your password.' });

      if (input.affiliationNumber) {
        const [dupe] = await tx
          .select({ id: clubs.id })
          .from(clubs)
          .where(and(eq(clubs.governingBodyId, input.governingBodyId), sql`lower(${clubs.affiliationNumber}) = lower(${input.affiliationNumber})`));
        if (dupe) throw fail({ affiliationNumber: 'A club with this affiliation number is already registered. If that is your club, ask your club’s account holder for the login.' });
      }

      if (input.directoryClubId) {
        const [d] = await tx
          .select({ id: directoryClubs.id, claimStatus: directoryClubs.claimStatus, governingBodyId: directoryClubs.governingBodyId })
          .from(directoryClubs)
          .where(eq(directoryClubs.id, input.directoryClubId));
        if (!d) throw fail({ directoryClubId: 'Choose a club from the list' });
        if (d.governingBodyId !== input.governingBodyId) throw fail({ directoryClubId: 'This directory record belongs to a different governing body' });
        const [live] = await tx
          .select({ id: clubClaims.id })
          .from(clubClaims)
          .where(and(eq(clubClaims.directoryClubId, d.id), inArray(clubClaims.status, ['pending', 'approved'])));
        if (d.claimStatus !== 'unclaimed' || live) throw fail({ directoryClubId: 'This club has already been claimed or has a claim waiting for review' });
      }

      const [club] = await tx
        .insert(clubs)
        .values({ name: input.clubName, slug: slugify(input.clubName), governingBodyId: input.governingBodyId, affiliationNumber: input.affiliationNumber, status: 'submitted' })
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
        metadata: { claim: Boolean(input.directoryClubId) },
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

export async function listGoverningBodiesPublic(): Promise<{ id: number; name: string }[]> {
  return withAuth((tx) => tx.select({ id: governingBodies.id, name: governingBodies.name }).from(governingBodies).orderBy(governingBodies.id));
}
