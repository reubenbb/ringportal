import 'server-only';
import { sql } from 'drizzle-orm';
import type { Tx } from '@/server/db/client';
import type { Availability } from '@/lib/boxers';

/**
 * Minimised reads of other clubs' data, through SECURITY DEFINER functions that
 * apply the visibility rules in the database (see drizzle/0008).
 */

export type BoxerCard = {
  id: string;
  clubId: string;
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
  archived: boolean;
  clubApproved: boolean;
};

type CardRow = {
  id: string;
  club_id: string;
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
  archived: boolean;
  club_approved: boolean;
};

export async function boxerCards(tx: Tx, ids: string[]): Promise<Map<string, BoxerCard>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const res = await tx.execute<CardRow>(sql`select * from boxer_cards(${sql.param(unique)}::uuid[])`);
  return new Map(
    res.rows.map((r) => [
      r.id,
      {
        id: r.id,
        clubId: r.club_id,
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
        archived: r.archived,
        clubApproved: r.club_approved,
      },
    ]),
  );
}

export type ClubName = { id: string; name: string; slug: string; isDemo: boolean; approved: boolean };

export async function clubNames(tx: Tx, ids: string[]): Promise<Map<string, ClubName>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const res = await tx.execute<{ id: string; name: string; slug: string; is_demo: boolean; approved: boolean }>(
    sql`select * from club_names(${sql.param(unique)}::uuid[])`,
  );
  return new Map(res.rows.map((r) => [r.id, { id: r.id, name: r.name, slug: r.slug, isDemo: r.is_demo, approved: r.approved }]));
}

/** Postgres unique-violation on a named constraint, whether or not the driver error is wrapped. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const pg = e as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === constraint) return true;
  }
  return false;
}
