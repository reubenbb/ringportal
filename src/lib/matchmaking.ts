/**
 * Transparent suitability scoring. Hard gates are applied before ranking (in the
 * database query and in gate()); a score can never override a gate. These are
 * RingPortal defaults for finding sensible opponents, NOT governing-body rules:
 * clubs must still check every bout against their governing body's regulations.
 */
export type MatchBoxer = {
  sex: 'male' | 'female';
  ageYears: number;
  isJunior: boolean;
  weightKg: number;
  totalBouts: number;
  skillsBouts: number;
  availability: string;
};

export const SCORE_WEIGHTS = { weight: 40, age: 25, experience: 25, skills: 10 } as const;
export const DEFAULTS = { toleranceKg: 2, juniorAgeGap: 1, adultAgeGap: 10, experienceSpan: 10, skillsSpan: 10, flagBoutGap: 5 } as const;
export const LIMITS = { toleranceKg: [0.5, 10], ageGap: [0, 20] } as const;

export const UNAVAILABLE = new Set(['injured_medical', 'inactive', 'confirmed']);

/** Reasons a candidate must never be shown as a normal suitable match. Empty = passes. */
export function gate(own: MatchBoxer, c: MatchBoxer): string[] {
  const fails: string[] = [];
  if (own.sex !== c.sex) fails.push('Different sex category');
  if (own.isJunior !== c.isJunior) fails.push('One boxer is under 18 and the other is 18 or over');
  if (UNAVAILABLE.has(c.availability)) fails.push('Not currently available');
  return fails;
}

const closeness = (diff: number, span: number) => Math.max(0, 1 - diff / span);

export type Factor = { key: keyof typeof SCORE_WEIGHTS; label: string; detail: string; points: number; max: number };

export function score(own: MatchBoxer, c: MatchBoxer, opts: { toleranceKg: number; ageGap: number }): { total: number; factors: Factor[]; flags: string[] } {
  const kg = Math.abs(own.weightKg - c.weightKg);
  const age = Math.abs(own.ageYears - c.ageYears);
  const bouts = Math.abs(own.totalBouts - c.totalBouts);
  const skills = Math.abs(own.skillsBouts - c.skillsBouts);
  const f = (key: Factor['key'], label: string, detail: string, ratio: number): Factor => ({ key, label, detail, max: SCORE_WEIGHTS[key], points: Math.round(SCORE_WEIGHTS[key] * ratio) });
  const factors = [
    f('weight', 'Weight', kg === 0 ? 'Same weight' : `${kg.toFixed(1)} kg apart`, closeness(kg, Math.max(opts.toleranceKg, 0.5) * 1.5)),
    f('age', 'Age', age === 0 ? 'Same age' : `${age} ${age === 1 ? 'year' : 'years'} apart`, closeness(age, Math.max(opts.ageGap, 1) * 1.5)),
    f('experience', 'Competitive bouts', `${own.totalBouts} v ${c.totalBouts}`, closeness(bouts, DEFAULTS.experienceSpan)),
    f('skills', 'Skills bouts', `${own.skillsBouts} v ${c.skillsBouts}`, closeness(skills, DEFAULTS.skillsSpan)),
  ];
  const flags: string[] = [];
  if (bouts >= DEFAULTS.flagBoutGap) flags.push(`Experience gap of ${bouts} competitive bouts`);
  if ((own.totalBouts === 0) !== (c.totalBouts === 0)) flags.push('One boxer has no competitive bouts');
  return { total: factors.reduce((n, x) => n + x.points, 0), factors, flags };
}

export const SORTS = ['best', 'weight', 'age', 'experience'] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABEL: Record<Sort, string> = { best: 'Best match', weight: 'Closest weight', age: 'Closest age', experience: 'Closest experience' };
