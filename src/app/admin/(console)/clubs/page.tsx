import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { CLUB_STATUS, formatDate } from '@/lib/club-status';
import { requireAdminPage } from '@/server/auth/guards';
import { CLUBS_PAGE, CLUB_FILTERS, listClubsForAdmin, type ClubFilter } from '@/server/clubs/admin';

export const metadata: Metadata = { title: 'Clubs' };

const LABEL: Record<ClubFilter, string> = { review: 'Awaiting review', approved: 'Approved', attention: 'Needs re-verification', closed: 'Rejected & suspended', all: 'All' };

export default async function AdminClubsPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; page?: string }> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const filter: ClubFilter = CLUB_FILTERS.includes(sp.filter as ClubFilter) ? (sp.filter as ClubFilter) : 'review';
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const q = sp.q?.trim() || undefined;
  const { rows, total, counts } = await listClubsForAdmin({ filter, q, page });
  const href = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ filter, q, ...o })) if (v) p.set(k, v);
    return `/admin/clubs?${p}`;
  };
  return (
    <>
      <PageHeader eyebrow="Platform administration" title="Clubs" description="Registered clubs and their verification status. Approve a club only after checking its affiliation." />
      <nav aria-label="Club filters" className="mb-4 flex flex-wrap gap-1">
        {CLUB_FILTERS.map((f) => (
          <Link key={f} href={href({ filter: f, page: undefined })} aria-current={filter === f ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm font-semibold ${filter === f ? 'bg-nav-active text-link' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
            {LABEL[f]} <span className="tabular-nums">({counts[f]})</span>
          </Link>
        ))}
      </nav>
      <form method="get" action="/admin/clubs" className="mb-4 flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="filter" value={filter} />
        <div className="flex flex-col gap-1">
          <label htmlFor="club-q" className="text-sm font-semibold text-ink">Search by name</label>
          <input id="club-q" name="q" type="search" defaultValue={q ?? ''} maxLength={80} className="rp-input w-72" />
        </div>
        <button type="submit" className="min-h-11 rounded-md border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-surface-2">Search</button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No clubs in this view.</p>
        ) : (
          <div className="relative -mx-5 -my-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <caption className="sr-only">Clubs</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2 font-semibold">Club</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Governing body</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Affiliation</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Directory claim</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">Boxers</th>
                  <th scope="col" className="px-5 py-2 font-semibold">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-2.5">
                      <Link href={`/admin/clubs/${c.id}`} className="font-semibold">{c.name}</Link> {c.isDemo ? <Badge tone="warning">Demo</Badge> : null}
                    </td>
                    <td className="px-2 py-2.5"><Badge tone={CLUB_STATUS[c.status].tone}>{CLUB_STATUS[c.status].label}</Badge></td>
                    <td className="px-2 py-2.5 text-ink">{c.governingBody}</td>
                    <td className="px-2 py-2.5 text-ink">
                      {c.affiliationNumber ?? <span className="text-muted">Not given</span>}
                      {c.affiliationExpired ? <> <Badge tone="danger">Expired {formatDate(c.affiliationExpiresOn)}</Badge></> : null}
                    </td>
                    <td className="px-2 py-2.5 text-ink">{c.pendingClaim ? <>Pending: {c.pendingClaim}</> : <span className="text-muted">—</span>}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink">{c.boxers}</td>
                    <td className="px-5 py-2.5 text-muted">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {total > CLUBS_PAGE ? (
        <p className="mt-4 flex justify-between text-sm">
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>← Previous</Link> : <span />}
          {page * CLUBS_PAGE < total ? <Link href={href({ page: String(page + 1) })}>Next →</Link> : <span />}
        </p>
      ) : null}
    </>
  );
}
