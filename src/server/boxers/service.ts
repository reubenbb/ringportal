import 'server-only';
import { and, asc, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAdmin, withClub, type Tx } from '@/server/db/client';
import { boxerAvailabilityHistory, boxerPrivate, boxers, clubUsers } from '@/server/db/schema';
import { audit } from '@/server/audit';
import { ApiError } from '@/server/http';
import type { ClubSession } from '@/server/auth/session';
import { AVAILABILITY, ageOn, type Availability } from '@/lib/boxers';

const count = (label: string) => z.coerce.number({ error: `Enter ${label}` }).int('Whole numbers only').min(0, 'Cannot be negative').max(999, 'Too high');

export const boxerInputSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter a first name').max(60),
  lastName: z.string().trim().min(1, 'Enter a surname').max(60),
  sex: z.enum(['male', 'female'], { error: 'Choose a sex/category' }),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date of birth')
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Enter a valid date of birth')
    .refine((v) => v >= '1940-01-01', 'Enter a valid date of birth')
    .refine((v) => new Date(`${v}T00:00:00Z`).getTime() <= Date.now(), 'Date of birth cannot be in the future'),
  weightKg: z.coerce.number({ error: 'Enter a weight in kg' }).min(20, 'Weight must be between 20 and 200 kg').max(200, 'Weight must be between 20 and 200 kg'),
  competitiveWins: count('wins'),
  competitiveLosses: count('losses'),
  competitiveDraws: count('draws'),
  skillsBouts: count('skills bouts'),
  medicalStatus: z.string().trim().max(500).optional().transform((v) => v || null),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
  /** Required for under-18s: the club confirms it holds parent/guardian consent. */
  guardianConsent: z.union([z.boolean(), z.literal('on')]).optional().transform(Boolean),
});
export type BoxerInput = z.infer<typeof boxerInputSchema>;
export const availabilitySchema = z.enum(AVAILABILITY);

export type OwnBoxer = {
  id: string;
  firstName: string;
  lastName: string;
  sex: 'male' | 'female';
  dateOfBirth: string;
  weightKg: number;
  competitiveWins: number;
  competitiveLosses: number;
  competitiveDraws: number;
  skillsBouts: number;
  availability: Availability;
  availabilityChangedAt: string;
  medicalStatus: string | null;
  notes: string | null;
  guardianConsentAt: string | null;
  archivedAt: string | null;
};

const ownColumns = {
  id: boxers.id,
  firstName: boxers.firstName,
  lastName: boxers.lastName,
  sex: boxers.sex,
  dateOfBirth: boxerPrivate.dateOfBirth,
  weightKg: boxers.weightKg,
  competitiveWins: boxers.competitiveWins,
  competitiveLosses: boxers.competitiveLosses,
  competitiveDraws: boxers.competitiveDraws,
  skillsBouts: boxers.skillsBouts,
  availability: boxers.availability,
  availabilityChangedAt: boxers.availabilityChangedAt,
  medicalStatus: boxerPrivate.medicalStatus,
  notes: boxerPrivate.notes,
  guardianConsentAt: boxerPrivate.guardianConsentAt,
  archivedAt: boxers.archivedAt,
};

type OwnRow = { [K in keyof typeof ownColumns]: unknown };
const toOwn = (r: OwnRow): OwnBoxer => ({
  ...(r as unknown as OwnBoxer),
  weightKg: Number(r.weightKg),
  availabilityChangedAt: (r.availabilityChangedAt as Date).toISOString(),
  archivedAt: r.archivedAt ? (r.archivedAt as Date).toISOString() : null,
  guardianConsentAt: r.guardianConsentAt ? (r.guardianConsentAt as Date).toISOString() : null,
});

const CONSENT_REQUIRED = 'Confirm that your club holds parent or guardian consent for this boxer';
const isMinor = (dateOfBirth: string) => ageOn(dateOfBirth) < 18;

type Meta = { ipHash: string };

export async function listOwnBoxers(session: ClubSession, opts: { archived?: boolean } = {}): Promise<OwnBoxer[]> {
  return withClub(session.clubId, async (tx) => {
    const rows = await tx
      .select(ownColumns)
      .from(boxers)
      .innerJoin(boxerPrivate, eq(boxerPrivate.boxerId, boxers.id))
      .where(and(eq(boxers.clubId, session.clubId), opts.archived ? isNotNull(boxers.archivedAt) : isNull(boxers.archivedAt)))
      .orderBy(asc(boxers.lastName), asc(boxers.firstName));
    return rows.map(toOwn);
  });
}

async function loadOwn(tx: Tx, session: ClubSession, id: string, lock = false) {
  const q = tx
    .select(ownColumns)
    .from(boxers)
    .innerJoin(boxerPrivate, eq(boxerPrivate.boxerId, boxers.id))
    .where(and(eq(boxers.id, id), eq(boxers.clubId, session.clubId)));
  const [row] = lock ? await q.for('update', { of: boxers }) : await q;
  return row ? toOwn(row) : null;
}

export type AvailabilityChange = { fromStatus: Availability | null; toStatus: Availability; changedAt: string; changedBy: string | null };

export async function getOwnBoxer(session: ClubSession, id: string): Promise<{ boxer: OwnBoxer; history: AvailabilityChange[] } | null> {
  return withClub(session.clubId, async (tx) => {
    const boxer = await loadOwn(tx, session, id);
    if (!boxer) return null;
    const history = await tx
      .select({
        fromStatus: boxerAvailabilityHistory.fromStatus,
        toStatus: boxerAvailabilityHistory.toStatus,
        changedAt: boxerAvailabilityHistory.changedAt,
        changedBy: clubUsers.email,
      })
      .from(boxerAvailabilityHistory)
      .leftJoin(clubUsers, eq(clubUsers.id, boxerAvailabilityHistory.changedBy))
      .where(eq(boxerAvailabilityHistory.boxerId, id))
      .orderBy(desc(boxerAvailabilityHistory.id))
      .limit(50);
    return { boxer, history: history.map((h) => ({ ...h, changedAt: h.changedAt.toISOString() })) };
  });
}

export async function createBoxer(session: ClubSession, input: BoxerInput, meta: Meta): Promise<{ id: string }> {
  const minor = isMinor(input.dateOfBirth);
  if (minor && !input.guardianConsent) throw new ApiError('validation_failed', 'Check the highlighted fields', { guardianConsent: CONSENT_REQUIRED });
  return withClub(session.clubId, async (tx) => {
    const [b] = await tx
      .insert(boxers)
      .values({
        clubId: session.clubId,
        firstName: input.firstName,
        lastName: input.lastName,
        sex: input.sex,
        weightKg: input.weightKg,
        competitiveWins: input.competitiveWins,
        competitiveLosses: input.competitiveLosses,
        competitiveDraws: input.competitiveDraws,
        skillsBouts: input.skillsBouts,
      })
      .returning({ id: boxers.id });
    await tx.insert(boxerPrivate).values({
      boxerId: b!.id, clubId: session.clubId, dateOfBirth: input.dateOfBirth, medicalStatus: input.medicalStatus, notes: input.notes,
      ...(minor ? { guardianConsentAt: new Date(), guardianConsentBy: session.clubUserId } : {}),
    });
    await tx.insert(boxerAvailabilityHistory).values({ boxerId: b!.id, clubId: session.clubId, fromStatus: null, toStatus: 'ready', changedBy: session.clubUserId });
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'boxer.created', targetType: 'boxer', targetId: b!.id, ipHash: meta.ipHash });
    return { id: b!.id };
  });
}

const PUBLIC_FIELDS = ['firstName', 'lastName', 'sex', 'weightKg', 'competitiveWins', 'competitiveLosses', 'competitiveDraws', 'skillsBouts'] as const;
const PRIVATE_FIELDS = ['dateOfBirth', 'medicalStatus', 'notes'] as const;

export async function updateBoxer(session: ClubSession, id: string, input: BoxerInput, meta: Meta): Promise<void> {
  const found = await withClub(session.clubId, async (tx) => {
    const prev = await loadOwn(tx, session, id, true);
    if (!prev) return false;
    if (prev.archivedAt) throw new ApiError('conflict', 'Restore this boxer before editing');
    // An under-18 without recorded consent cannot be saved until the club confirms it.
    const recordConsent = isMinor(input.dateOfBirth) && !prev.guardianConsentAt;
    if (recordConsent && !input.guardianConsent) throw new ApiError('validation_failed', 'Check the highlighted fields', { guardianConsent: CONSENT_REQUIRED });
    const changed = [...PUBLIC_FIELDS, ...PRIVATE_FIELDS].filter((k) => (prev[k] ?? null) !== (input[k] ?? null));
    if (!changed.length && !recordConsent) return true;
    await tx
      .update(boxers)
      .set(Object.fromEntries(PUBLIC_FIELDS.map((k) => [k, input[k]])))
      .where(eq(boxers.id, id));
    await tx
      .update(boxerPrivate)
      .set({ dateOfBirth: input.dateOfBirth, medicalStatus: input.medicalStatus, notes: input.notes, ...(recordConsent ? { guardianConsentAt: new Date(), guardianConsentBy: session.clubUserId } : {}) })
      .where(eq(boxerPrivate.boxerId, id));
    // Field names only: values (DOB, medical, notes) never go into the audit log.
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: 'boxer.updated', targetType: 'boxer', targetId: id, metadata: { fields: recordConsent ? [...changed, 'guardianConsent'] : changed }, ipHash: meta.ipHash });
    return true;
  });
  if (!found) throw new ApiError('not_found', 'Boxer not found');
}

export async function setAvailability(session: ClubSession, id: string, status: Availability, meta: Meta): Promise<{ changed: boolean }> {
  const result = await withClub(session.clubId, async (tx) => {
    const prev = await loadOwn(tx, session, id, true);
    if (!prev) return null;
    if (prev.archivedAt) throw new ApiError('conflict', 'Restore this boxer before changing availability');
    if (prev.availability === status) return { changed: false };
    await tx.update(boxers).set({ availability: status, availabilityChangedAt: new Date() }).where(eq(boxers.id, id));
    await tx.insert(boxerAvailabilityHistory).values({ boxerId: id, clubId: session.clubId, fromStatus: prev.availability, toStatus: status, changedBy: session.clubUserId });
    await audit(tx, {
      actorType: 'club_user',
      actorId: session.clubUserId,
      clubId: session.clubId,
      action: 'boxer.availability_changed',
      targetType: 'boxer',
      targetId: id,
      metadata: { from: prev.availability, to: status },
      ipHash: meta.ipHash,
    });
    return { changed: true };
  });
  if (!result) throw new ApiError('not_found', 'Boxer not found');
  return result;
}

export async function setArchived(session: ClubSession, id: string, archived: boolean, meta: Meta): Promise<void> {
  const ok = await withClub(session.clubId, async (tx) => {
    const prev = await loadOwn(tx, session, id, true);
    if (!prev) return false;
    if (Boolean(prev.archivedAt) === archived) return true;
    await tx.update(boxers).set({ archivedAt: archived ? new Date() : null }).where(eq(boxers.id, id));
    await audit(tx, { actorType: 'club_user', actorId: session.clubUserId, clubId: session.clubId, action: archived ? 'boxer.archived' : 'boxer.restored', targetType: 'boxer', targetId: id, ipHash: meta.ipHash });
    return true;
  });
  if (!ok) throw new ApiError('not_found', 'Boxer not found');
}

// Cross-club, minimised roster -------------------------------------------------

export type RosterBoxer = {
  id: string;
  displayName: string;
  sex: 'male' | 'female';
  ageYears: number;
  isJunior: boolean;
  weightKg: number;
  competitiveWins: number;
  competitiveLosses: number;
  competitiveDraws: number;
  totalBouts: number;
  skillsBouts: number;
  availability: Availability;
  availabilityChangedAt: string;
};

type RosterRow = {
  id: string;
  display_name: string;
  sex: 'male' | 'female';
  age_years: number;
  is_junior: boolean;
  weight_kg: string;
  competitive_wins: number;
  competitive_losses: number;
  competitive_draws: number;
  total_bouts: number;
  skills_bouts: number;
  availability: Availability;
  availability_changed_at: Date;
};

async function roster(tx: Tx, clubId: string): Promise<RosterBoxer[]> {
  const res = await tx.execute<RosterRow>(sql`select * from club_boxer_roster(${clubId}::uuid)`);
  return res.rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    sex: r.sex,
    ageYears: Number(r.age_years),
    isJunior: r.is_junior,
    weightKg: Number(r.weight_kg),
    competitiveWins: Number(r.competitive_wins),
    competitiveLosses: Number(r.competitive_losses),
    competitiveDraws: Number(r.competitive_draws),
    totalBouts: Number(r.total_bouts),
    skillsBouts: Number(r.skills_bouts),
    availability: r.availability,
    availabilityChangedAt: new Date(r.availability_changed_at).toISOString(),
  }));
}

/** What an approved club may see of another approved club's boxers. Empty for unapproved viewers or clubs. */
export function rosterForClubViewer(viewer: ClubSession, targetClubId: string): Promise<RosterBoxer[]> {
  return withClub(viewer.clubId, (tx) => roster(tx, targetClubId));
}

export function rosterForAdmin(targetClubId: string): Promise<RosterBoxer[]> {
  return withAdmin((tx) => roster(tx, targetClubId));
}

// Approved RingPortal clubs (public listing fields only) ----------------------

export type ListedClub = { id: string; name: string; slug: string; governingBody: string; isDemo: boolean; activeBoxers: number };
type ListedRow = { id: string; name: string; slug: string; governing_body: string; is_demo: boolean; active_boxers: number };

async function listing(tx: Tx): Promise<ListedClub[]> {
  const res = await tx.execute<ListedRow>(sql`select * from approved_club_listing()`);
  return res.rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, governingBody: r.governing_body, isDemo: r.is_demo, activeBoxers: Number(r.active_boxers) }));
}

export function listApprovedClubsForClub(viewer: ClubSession): Promise<ListedClub[]> {
  return withClub(viewer.clubId, listing);
}

export function listApprovedClubsForAdmin(): Promise<ListedClub[]> {
  return withAdmin(listing);
}
