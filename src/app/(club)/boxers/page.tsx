import type { Metadata } from 'next';
import Link from 'next/link';
import { AvailabilitySelect } from '@/components/boxers/availability-select';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { SEX_LABEL, ageOn, formatKg, recordLabel } from '@/lib/boxers';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { listOwnBoxers } from '@/server/boxers/service';

export const metadata: Metadata = { title: 'My boxers' };

export default async function MyBoxersPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  const header = (
    <PageHeader
      eyebrow="Your club"
      title="My boxers"
      description="Your roster. Other approved clubs see each boxer's age, weight, record and availability — never dates of birth, medical status or notes."
      actions={approved ? <Link href="/boxers/new" className={buttonClass('primary')}>Add boxer</Link> : undefined}
    />
  );
  if (!approved) return <>{header}<NotApprovedNotice feature="Boxer management" /></>;
  const archived = (await searchParams).archived === '1';
  const list = await listOwnBoxers(session, { archived });

  return (
    <>
      {header}
      <nav aria-label="Roster view" className="mb-4 flex gap-4 text-sm font-semibold">
        <Link href="/boxers" aria-current={!archived ? 'page' : undefined} className={archived ? 'text-muted' : ''}>Active</Link>
        <Link href="/boxers?archived=1" aria-current={archived ? 'page' : undefined} className={archived ? '' : 'text-muted'}>Archived</Link>
      </nav>
      <Card>
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="font-semibold text-ink">{archived ? 'No archived boxers' : 'No boxers yet'}</p>
            {!archived ? (
              <>
                <p className="max-w-sm text-sm text-muted">Add your boxers so approved clubs can see who is available for bouts.</p>
                <Link href="/boxers/new" className={buttonClass('primary')}>Add your first boxer</Link>
              </>
            ) : null}
          </div>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">{archived ? 'Archived boxers' : 'Active boxers'}</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2 font-semibold">Boxer</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Age</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Sex</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Weight</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Record (W–L–D)</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Skills</th>
                  <th scope="col" className="px-5 py-2 font-semibold">Availability</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((b) => {
                  const age = ageOn(b.dateOfBirth);
                  return (
                    <tr key={b.id} className="align-middle">
                      <td className="px-5 py-2.5">
                        <Link href={`/boxers/${b.id}`} className="font-semibold">
                          {b.firstName} {b.lastName}
                        </Link>{' '}
                        {age < 18 ? <Badge tone="neutral">Junior</Badge> : null}
                      </td>
                      <td className="px-2 py-2.5 tabular-nums text-ink">{age}</td>
                      <td className="px-2 py-2.5 text-ink">{SEX_LABEL[b.sex]}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-ink">{formatKg(b.weightKg)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-ink">{recordLabel(b.competitiveWins, b.competitiveLosses, b.competitiveDraws)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-ink">{b.skillsBouts}</td>
                      <td className="px-5 py-2">
                        {archived ? <span className="text-muted">Archived</span> : <AvailabilitySelect boxerId={b.id} value={b.availability} name={`${b.firstName} ${b.lastName}`} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
