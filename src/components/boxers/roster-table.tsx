import { Badge } from '@/components/ui/card';
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, SEX_LABEL, formatKg, recordLabel } from '@/lib/boxers';
import type { RosterBoxer } from '@/server/boxers/service';

/** Another club's boxers, minimised: no dates of birth, medical details or notes; juniors' surnames shortened. */
export function RosterTable({ boxers, emptyText }: { boxers: RosterBoxer[]; emptyText: string }) {
  if (boxers.length === 0) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  return (
    <>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <caption className="sr-only">Boxers</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-5 py-2 font-semibold">Boxer</th>
              <th scope="col" className="px-2 py-2 font-semibold">Age</th>
              <th scope="col" className="px-2 py-2 font-semibold">Sex</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Weight</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold" title="Competitive wins–losses–draws">Record (W–L–D)</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Bouts</th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">Skills</th>
              <th scope="col" className="px-5 py-2 font-semibold">Availability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {boxers.map((b) => (
              <tr key={b.id}>
                <td className="px-5 py-2.5 font-semibold text-ink">
                  {b.displayName} {b.isJunior ? <Badge tone="neutral">Junior</Badge> : null}
                </td>
                <td className="px-2 py-2.5 tabular-nums text-ink">{b.ageYears}</td>
                <td className="px-2 py-2.5 text-ink">{SEX_LABEL[b.sex]}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink">{formatKg(b.weightKg)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink">{recordLabel(b.competitiveWins, b.competitiveLosses, b.competitiveDraws)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink">{b.totalBouts}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink">{b.skillsBouts}</td>
                <td className="px-5 py-2.5">
                  <Badge tone={AVAILABILITY_TONE[b.availability]}>{AVAILABILITY_LABEL[b.availability]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Skills bouts are listed separately and are not part of the competitive record. For boxers under 18 only the first name and surname initial are shown. Dates of birth and medical details are never shared with other clubs.
      </p>
    </>
  );
}
