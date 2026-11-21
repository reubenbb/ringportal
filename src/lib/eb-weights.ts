/**
 * England Boxing Rule Book 26.3, Section 13 weight categories, used for the club rule that two Junior, Youth or
 * Senior boxers may differ by no more than the smaller of their two weight-category spans (2.5.5, 2.6.6, 2.7.8).
 * Junior: 13.3 Junior Championships (same for male and female). Youth: 13.5 Youth Championships. Senior: 13.6
 * Senior Development Championships. Each list is the upper limits in kg, with the lower limit of the first band
 * where the table gives one. A boxer in the lightest band with no lower limit, below the first band, or in the
 * open "Over" band has no defined span; RingPortal then flags gaps over 2 kg for the coaches instead of refusing.
 */
import type { EbCategory } from '@/lib/eb-rules';

type Table = { firstMin: number | null; limits: number[] };

const JUNIOR: Table = { firstMin: null, limits: [36, 38, 40, 42, 44, 46, 48, 50, 52, 54, 57, 60, 63, 66, 70, 75, 80] };

const TABLES: Partial<Record<EbCategory, Record<'male' | 'female', Table>>> = {
  junior: { male: JUNIOR, female: JUNIOR },
  youth: {
    male: { firstMin: 45, limits: [47, 50, 52.5, 55, 57.5, 60, 62.5, 65, 70, 75, 80, 85, 90] },
    female: { firstMin: 43, limits: [45, 48, 51, 54, 57, 60, 62.5, 65, 67.5, 70, 75, 80] },
  },
  senior: {
    male: { firstMin: 47, limits: [50, 52.5, 55, 57.5, 60, 62.5, 65, 70, 75, 80, 85, 90] },
    female: { firstMin: 45, limits: [48, 51, 54, 57, 60, 62.5, 65, 67.5, 70, 75, 80] },
  },
};

export type WeightBand = { label: string; min: number; max: number; span: number };

const EPS = 1e-9;
const kg = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;

/** The weight category a boxer falls in, with its span, or null when the span is not defined. */
export function weightBand(category: EbCategory, sex: 'male' | 'female', weightKg: number): WeightBand | null {
  const t = TABLES[category]?.[sex];
  if (!t) return null;
  for (let i = 0; i < t.limits.length; i++) {
    const max = t.limits[i]!;
    const min = i === 0 ? t.firstMin : t.limits[i - 1]!;
    if (weightKg <= max + EPS) {
      if (min === null || weightKg < min - EPS) return null; // lightest open band, or below the first band
      // Limits are upper bounds: a weight exactly on a limit is in that band.
      return { label: i === 0 ? `${kg(min)}–${kg(max)}` : `Under ${kg(max)}`, min, max, span: Math.round((max - min) * 10) / 10 };
    }
  }
  return null; // the open "Over" band
}
