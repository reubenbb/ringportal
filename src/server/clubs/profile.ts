import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withClub } from '@/server/db/client';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import { hit, LIMITS } from '@/server/auth/rate-limit';
import type { ClubSession } from '@/server/auth/session';

const optional = (max: number) => z.string().trim().max(max, `Use ${max} characters or fewer`).optional().nullable().transform((v) => v || null);

export const clubProfileSchema = z.object({
  about: optional(1500),
  website: optional(200).refine((v) => v === null || /^https:\/\/[^\s/$.?#][^\s]*$/i.test(v), 'Enter a full web address starting with https://'),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.email().safeParse(v).success, 'Enter a valid email address'),
  trainingVenue: optional(200),
});
export type ClubProfileInput = z.infer<typeof clubProfileSchema>;

export type ClubProfile = { region: string | null; about: string | null; website: string | null; contactEmail: string | null; trainingVenue: string | null };

/** Another approved club's profile (or your own). Null when the viewer may not see it. */
export async function getClubProfile(session: ClubSession, clubId: string): Promise<ClubProfile | null> {
  return withClub(session.clubId, async (tx) => {
    const res = await tx.execute<{ region: string | null; about: string | null; website: string | null; contact_email: string | null; training_venue: string | null }>(sql`select * from club_public_profile(${clubId}::uuid)`);
    const r = res.rows[0];
    return r ? { region: r.region, about: r.about, website: r.website, contactEmail: r.contact_email, trainingVenue: r.training_venue } : null;
  });
}

export async function updateOwnProfile(session: ClubSession, input: ClubProfileInput, meta: { ipHash: string }): Promise<void> {
  await withClub(session.clubId, async (tx) => {
    const r = await hit(tx, LIMITS.sensitiveAction, `profile:${session.clubId}`);
    if (!r.allowed) throw new ApiError('rate_limited', 'Too many changes. Please wait a few minutes.', undefined, r.retryAfterSeconds);
    await tx.execute(sql`select update_club_profile(${input.about}, ${input.website}, ${input.contactEmail}, ${input.trainingVenue})`);
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'club.profile_updated', targetType: 'club', targetId: session.clubId, metadata: { fields: Object.entries(input).filter(([, v]) => v !== null).map(([k]) => k) }, ipHash: meta.ipHash });
  });
}
