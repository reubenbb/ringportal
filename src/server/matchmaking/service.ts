import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withClub } from '@/server/db/client';
import { directoryClubs } from '@/server/db/schema';
import { ENGLAND_BOXING_ID } from '@/lib/governing-body';
import type { ClubSession } from '@/server/auth/session';
import { boxerCards, type BoxerCard } from '@/server/cross-club';
import { DEFAULTS, LIMITS, SORTS, gate, score, type Factor, type Sort } from '@/lib/matchmaking';
import type { Availability } from '@/lib/boxers';

const num = (min: number, max: number) => z.coerce.number().min(min).max(max);

/** Query-string filters. Anything invalid falls back to the default rather than erroring. */
export const matchQuerySchema = z.object({
  boxer: z.uuid().optional().catch(undefined),
  tol: num(LIMITS.toleranceKg[0], LIMITS.toleranceKg[1]).optional().catch(undefined),
  ageGap: num(LIMITS.ageGap[0], LIMITS.ageGap[1]).optional().catch(undefined),
  boutGap: z.coerce.number().int().min(0).max(200).optional().catch(undefined),
  region: z.string().trim().min(1).max(80).optional().catch(undefined),
  unavailable: z.literal('1').optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  view: z.enum(['table', 'cards']).optional().catch(undefined),
});
export type MatchQuery = z.infer<typeof matchQuerySchema>;

/** Parses search params. Blank fields from the form mean "not set" (they must not coerce to 0). */
export function parseMatchQuery(raw: Record<string, string | string[] | undefined>): MatchQuery {
  const flat = Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v] as const);
  return matchQuerySchema.parse(Object.fromEntries(flat.filter(([, v]) => typeof v === 'string' && v.trim() !== '')));
}

export type MatchResult = {
  id: string;
  clubId: string;
  clubName: string;
  clubSlug: string;
  clubIsDemo: boolean;
  clubRegion: string | null;
  governingBody: string;
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
  score: number;
  factors: Factor[];
  flags: string[];
  /** Hard gate failures: never shown as a normal suitable match. */
  blocked: string[];
};

type Row = {
  id: string; club_id: string; club_name: string; club_slug: string; club_is_demo: boolean; club_region: string | null; governing_body: string; display_name: string;
  sex: 'male' | 'female'; age_years: number; is_junior: boolean; weight_kg: string; competitive_wins: number; competitive_losses: number;
  competitive_draws: number; total_bouts: number; skills_bouts: number; availability: Availability;
};

export type MatchSearch = {
  own: BoxerCard;
  filters: { toleranceKg: number; ageGap: number; boutGap: number | null; region: string | null; includeUnavailable: boolean; sort: Sort; minAge: number; maxAge: number };
  suitable: MatchResult[];
  blocked: MatchResult[];
};

export async function searchMatches(session: ClubSession, ownBoxerId: string, q: MatchQuery): Promise<MatchSearch | null> {
  return withClub(session.clubId, async (tx) => {
    const own = (await boxerCards(tx, [ownBoxerId])).get(ownBoxerId);
    if (!own || own.clubId !== session.clubId || own.archived) return null;
    const toleranceKg = q.tol ?? DEFAULTS.toleranceKg;
    const ageGap = q.ageGap ?? (own.isJunior ? DEFAULTS.juniorAgeGap : DEFAULTS.adultAgeGap);
    // Gate before ranking: under-18s are only ever searched against under-18s, adults against adults.
    const minAge = own.isJunior ? Math.max(own.ageYears - ageGap, 0) : Math.max(own.ageYears - ageGap, 18);
    const maxAge = own.isJunior ? Math.min(own.ageYears + ageGap, 17) : own.ageYears + ageGap;
    const includeUnavailable = q.unavailable === '1';
    const res = await tx.execute<Row>(sql`
      select * from match_candidates(${own.sex}::boxer_sex, ${own.weightKg - toleranceKg}::numeric, ${own.weightKg + toleranceKg}::numeric,
        ${minAge}::int, ${maxAge}::int, ${ENGLAND_BOXING_ID}::smallint, ${includeUnavailable}, ${q.region ?? null}::text)`);
    const sort = q.sort ?? 'best';
    const all = res.rows
      .map((r): MatchResult => {
        const c = {
          id: r.id, clubId: r.club_id, clubName: r.club_name, clubSlug: r.club_slug, clubIsDemo: r.club_is_demo, clubRegion: r.club_region, governingBody: r.governing_body,
          displayName: r.display_name, sex: r.sex, ageYears: Number(r.age_years), isJunior: r.is_junior, weightKg: Number(r.weight_kg),
          competitiveWins: Number(r.competitive_wins), competitiveLosses: Number(r.competitive_losses), competitiveDraws: Number(r.competitive_draws),
          totalBouts: Number(r.total_bouts), skillsBouts: Number(r.skills_bouts), availability: r.availability,
        };
        const s = score(own, c, { toleranceKg, ageGap });
        return { ...c, score: s.total, factors: s.factors, flags: s.flags, blocked: gate(own, c) };
      })
      .filter((r) => q.boutGap === undefined || Math.abs(r.totalBouts - own.totalBouts) <= q.boutGap);
    const by: Record<Sort, (a: MatchResult, b: MatchResult) => number> = {
      best: (a, b) => b.score - a.score,
      weight: (a, b) => Math.abs(a.weightKg - own.weightKg) - Math.abs(b.weightKg - own.weightKg),
      age: (a, b) => Math.abs(a.ageYears - own.ageYears) - Math.abs(b.ageYears - own.ageYears),
      experience: (a, b) => Math.abs(a.totalBouts - own.totalBouts) - Math.abs(b.totalBouts - own.totalBouts),
    };
    // Stable, predictable order: chosen sort, then score, then id.
    all.sort((a, b) => by[sort](a, b) || b.score - a.score || a.id.localeCompare(b.id));
    return {
      own,
      filters: { toleranceKg, ageGap, boutGap: q.boutGap ?? null, region: q.region ?? null, includeUnavailable, sort, minAge, maxAge },
      suitable: all.filter((r) => !r.blocked.length).slice(0, 100),
      blocked: all.filter((r) => r.blocked.length).slice(0, 50),
    };
  });
}

/** Regions clubs can be filtered by: the England Boxing directory's regions. */
export async function listRegions(session: ClubSession): Promise<string[]> {
  return withClub(session.clubId, async (tx) => {
    const rows = await tx.selectDistinct({ region: directoryClubs.region }).from(directoryClubs).where(sql`${directoryClubs.region} is not null`).orderBy(directoryClubs.region);
    return rows.map((r) => r.region!);
  });
}
