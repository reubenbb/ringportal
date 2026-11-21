import 'server-only';
import { sql } from 'drizzle-orm';
import type { Tx } from '@/server/db/client';
import type { EbCategory, GapBand, PairFacts } from '@/lib/eb-rules';

type Row = { boxer_id: string; own_category: EbCategory; category: EbCategory; gap_band: GapBand; own_skills_age: boolean; skills_age: boolean };

/** Matrix facts for the own boxer against each other boxer; dates of birth never leave the database. */
export async function pairFacts(tx: Tx, ownId: string, otherIds: string[]): Promise<Map<string, PairFacts>> {
  const ids = [...new Set(otherIds)];
  if (!ids.length) return new Map();
  const res = await tx.execute<Row>(sql`select * from eb_pair_facts(${ownId}::uuid, ${sql.param(ids)}::uuid[])`);
  return new Map(
    res.rows.map((r) => [r.boxer_id, { ownCategory: r.own_category, category: r.category, gapBand: r.gap_band, ownSkillsAge: r.own_skills_age, skillsAge: r.skills_age }]),
  );
}
