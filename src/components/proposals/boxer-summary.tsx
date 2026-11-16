import { Badge } from '@/components/ui/card';
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, SEX_LABEL, formatKg, recordLabel } from '@/lib/boxers';
import type { BoxerCard } from '@/server/cross-club';

/** Minimised boxer card (same fields other clubs may see; no DOB, medical or notes). */
export function BoxerSummary({ boxer, clubName, label }: { boxer: BoxerCard | null; clubName: string; label: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-2/50 p-4">
      <p className="rp-eyebrow">{label}</p>
      {boxer ? (
        <>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold text-ink">
            {boxer.displayName}
            {boxer.isJunior ? <Badge tone="neutral">Junior</Badge> : null}
          </p>
          <p className="text-sm text-muted">{clubName}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted">Age</dt>
            <dd className="tabular-nums text-ink">{boxer.ageYears}</dd>
            <dt className="text-muted">Sex</dt>
            <dd className="text-ink">{SEX_LABEL[boxer.sex]}</dd>
            <dt className="text-muted">Weight</dt>
            <dd className="tabular-nums text-ink">{formatKg(boxer.weightKg)}</dd>
            <dt className="text-muted" title="Competitive wins–losses–draws">Record</dt>
            <dd className="tabular-nums text-ink">
              {recordLabel(boxer.competitiveWins, boxer.competitiveLosses, boxer.competitiveDraws)} <span className="text-muted">({boxer.totalBouts} bouts)</span>
            </dd>
            <dt className="text-muted">Skills bouts</dt>
            <dd className="tabular-nums text-ink">{boxer.skillsBouts}</dd>
            <dt className="text-muted">Availability</dt>
            <dd>
              <Badge tone={AVAILABILITY_TONE[boxer.availability]}>{AVAILABILITY_LABEL[boxer.availability]}</Badge>
            </dd>
          </dl>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">This boxer is no longer listed.</p>
      )}
    </div>
  );
}

/** Plain-language points both clubs should check. Advisory only: not a governing-body eligibility decision. */
export function matchNotes(a: BoxerCard | null, b: BoxerCard | null, weightKg?: number): string[] {
  if (!a || !b) return [];
  const notes: string[] = [];
  const diff = Math.abs(a.weightKg - b.weightKg);
  if (diff >= 3) notes.push(`The boxers' recorded weights differ by ${diff.toFixed(1)} kg.`);
  if (weightKg !== undefined) {
    for (const x of [a, b]) {
      const d = Math.abs(x.weightKg - weightKg);
      if (d >= 3) notes.push(`${x.displayName} is recorded at ${formatKg(x.weightKg)}, ${d.toFixed(1)} kg from the proposed ${formatKg(weightKg)}.`);
    }
  }
  if (a.isJunior !== b.isJunior) notes.push('One boxer is under 18 and the other is 18 or over.');
  else if (Math.abs(a.ageYears - b.ageYears) >= 3) notes.push(`There is an age gap of ${Math.abs(a.ageYears - b.ageYears)} years.`);
  if (Math.abs(a.totalBouts - b.totalBouts) >= 5) notes.push(`Competitive experience differs: ${a.totalBouts} v ${b.totalBouts} bouts.`);
  return notes;
}
