export const AVAILABILITY = ['ready', 'injured_medical', 'provisionally_arranged', 'confirmed', 'inactive'] as const;
export type Availability = (typeof AVAILABILITY)[number];

/** Exact labels from the product brief. */
export const AVAILABILITY_LABEL: Record<Availability, string> = {
  ready: 'Ready',
  injured_medical: 'Injured / medical',
  provisionally_arranged: 'Provisionally arranged',
  confirmed: 'Confirmed',
  inactive: 'Inactive',
};

export const AVAILABILITY_TONE: Record<Availability, 'success' | 'danger' | 'warning' | 'blue' | 'neutral'> = {
  ready: 'success',
  injured_medical: 'danger',
  provisionally_arranged: 'warning',
  confirmed: 'blue',
  inactive: 'neutral',
};

export const SEX_LABEL = { male: 'Male', female: 'Female' } as const;

export function recordLabel(w: number, l: number, d: number): string {
  return `${w}–${l}–${d}`;
}

export function formatKg(kg: number | string): string {
  const n = typeof kg === 'string' ? Number(kg) : kg;
  return `${n.toFixed(n % 1 === 0 ? 0 : 1)} kg`;
}

/** Age in whole years on the given date (UTC, date-only). */
export function ageOn(dateOfBirth: string, today = new Date()): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const md = (today.getUTCMonth() + 1) * 100 + today.getUTCDate();
  if (md < m * 100 + d) age--;
  return age;
}

/** RingPortal default, not an England Boxing rule: a weight older than this is flagged as possibly out of date. */
export const WEIGHT_STALE_DAYS = 28;

export function weightAgeDays(recordedAt: string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(recordedAt).getTime()) / 86_400_000));
}

export function weightIsStale(recordedAt: string, now = new Date()): boolean {
  return weightAgeDays(recordedAt, now) > WEIGHT_STALE_DAYS;
}
