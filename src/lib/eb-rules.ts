/**
 * England Boxing Rule Book 26.3 (2026 Club Boxing Matrix and Annex C2), as far as RingPortal can check it.
 * RingPortal is stricter in one place: an under-18 is never matched with someone 18 or over, although the
 * matrix allows Youth v Senior. Junior, Youth and Senior weight differences use the Section 13 weight-category spans
 * (see eb-weights.ts); where a boxer has no defined span, a gap over 2 kg is flagged rather than refused.
 */
import { weightBand } from '@/lib/eb-weights';

export const RULEBOOK = 'England Boxing Rule Book 26.3 (2026 Club Boxing Matrix)';

export const EB_CATEGORIES = ['too_young', 'minor', 'schools', 'junior', 'youth', 'senior', 'outside'] as const;
export type EbCategory = (typeof EB_CATEGORIES)[number];
export type GapBand = 'lt12' | 'lt24' | 'ge24';

export const EB_CATEGORY_LABEL: Record<EbCategory, string> = {
  too_young: 'Under 10',
  minor: 'Minor',
  schools: 'Schools',
  junior: 'Junior',
  youth: 'Youth',
  senior: 'Senior',
  outside: 'Outside the matrix',
};

type Boxable = Exclude<EbCategory, 'too_young' | 'outside'>;

/** Permitted pairings and the largest age-gap band each allows (null: no age-gap rule). */
const PAIRS: Record<string, GapBand | null> = {
  'minor|minor': 'lt12',
  'minor|schools': 'lt12',
  'schools|schools': 'lt12',
  'junior|schools': 'lt12',
  'junior|junior': 'lt24',
  'junior|youth': 'lt12',
  'youth|youth': 'lt24',
  'senior|youth': 'lt12',
  'senior|senior': null,
};

/** Keys above are in alphabetical order. */
const pairKey = (a: Boxable, b: Boxable) => [a, b].sort().join('|');

export type PairFacts = { ownCategory: EbCategory; category: EbCategory; gapBand: GapBand; ownSkillsAge: boolean; skillsAge: boolean };
export type PairBoxer = { sex: 'male' | 'female'; weightKg: number; totalBouts: number; skillsBouts: number };

const GAP_TEXT: Record<GapBand, string> = { lt12: 'under 12 months', lt24: 'under 24 months', ge24: '24 months or more' };
const within = (gap: GapBand, max: GapBand) => (max === 'lt24' ? gap !== 'ge24' : gap === 'lt12');

/** Matrix checks for a competitive bout. `fails` refuse the pairing; `flags` are shown to coaches. */
export function competitiveCheck(f: PairFacts, own: PairBoxer, other: PairBoxer): { fails: string[]; flags: string[] } {
  const fails: string[] = [];
  const flags: string[] = [];
  for (const c of [f.ownCategory, f.category]) {
    if (c === 'too_young') fails.push('England Boxing does not allow under-10s to box');
    if (c === 'outside') fails.push('Born before 1986: outside England Boxing’s 2026 club matrix');
  }
  if (fails.length) return { fails: [...new Set(fails)], flags };
  const a = f.ownCategory as Boxable;
  const b = f.category as Boxable;
  const key = pairKey(a, b);
  if (!(key in PAIRS)) {
    fails.push(`England Boxing does not allow ${EB_CATEGORY_LABEL[a]} v ${EB_CATEGORY_LABEL[b]}`);
    return { fails, flags };
  }
  const max = PAIRS[key]!;
  if (max && !within(f.gapBand, max)) fails.push(`Age gap must be ${GAP_TEXT[max]} for ${EB_CATEGORY_LABEL[a]} v ${EB_CATEGORY_LABEL[b]}`);
  else if (max === 'lt24' && f.gapBand === 'lt24') flags.push('More than 12 months apart in age: England Boxing advises extra caution');
  if (key === 'senior|youth') flags.push('Senior v Youth: both boxers must wear head guards');
  const kg = Math.abs(own.weightKg - other.weightKg);
  const diff = `Weight difference of ${kg.toFixed(1)} kg`;
  if (a === 'minor' || a === 'schools' || b === 'minor' || b === 'schools') {
    if (kg > 2 + 1e-9) fails.push(`${diff}: the limit for Minors and Schools is 2 kg`);
  } else {
    // Junior, Youth and Senior: no more than the smaller of the two weight-category spans.
    const bands = [weightBand(a, own.sex, own.weightKg), weightBand(b, other.sex, other.weightKg)];
    if (bands[0] && bands[1]) {
      const smaller = bands[0].span <= bands[1].span ? bands[0] : bands[1];
      if (kg > smaller.span + 1e-9) fails.push(`${diff}: the limit is ${smaller.span} kg, the span of the smaller weight category (${smaller.label})`);
    } else if (kg > 2 + 1e-9) {
      flags.push(`${diff}: no weight-category span to check against, so check it against England Boxing’s weight categories`);
    }
  }
  return { fails, flags };
}

/** Annex C2: extra conditions for a skills bout. */
export function skillsCheck(f: PairFacts, own: PairBoxer, other: PairBoxer): string[] {
  const fails: string[] = [];
  if (!f.ownSkillsAge || !f.skillsAge) fails.push('Skills bouts are only for boxers from their 10th birthday to the day before their 16th');
  if (f.gapBand !== 'lt12') fails.push('Skills bout boxers must be within 12 months of each other in age');
  if (Math.abs(own.weightKg - other.weightKg) > 2) fails.push('Skills bouts are not allowed with a weight difference over 2 kg');
  if (own.totalBouts > 0 || other.totalBouts > 0) fails.push('Skills bouts are not allowed after a boxer’s first competitive bout');
  if (own.skillsBouts >= 6 || other.skillsBouts >= 6) fails.push('A boxer can have at most 6 skills bouts');
  return fails;
}
