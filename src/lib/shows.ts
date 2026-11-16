/** Converts a UK local date and time to a UTC instant (handles GMT/BST). */
export function londonToUtc(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...opts });
export const formatShowDate = (iso: string) => fmt({ weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
export const formatShowTime = (iso: string) => fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
/** YYYY-MM-DD and HH:MM in UK time, for form defaults. */
export function londonParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d), time: formatShowTime(iso) };
}

export type RequestCriteria = { sex: 'male' | 'female'; minAge: number; maxAge: number; weightKg: number };
export const REQUEST_TOLERANCE_KG = 2;
/** Whether one of your boxers fits an opponent request's stated criteria (advisory only). */
export function fitsRequest(b: { sex: string; ageYears: number; weightKg: number; availability: string }, r: RequestCriteria): boolean {
  return b.sex === r.sex && b.ageYears >= r.minAge && b.ageYears <= r.maxAge && Math.abs(b.weightKg - r.weightKg) <= REQUEST_TOLERANCE_KG && !['injured_medical', 'inactive', 'confirmed'].includes(b.availability);
}
