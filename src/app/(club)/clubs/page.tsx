import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { AddressStatusBadges } from '@/components/directory/profile-view';
import { Alert } from '@/components/ui/alert';
import { buttonClass } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { listDirectoryForClub } from '@/server/directory/profiles';

export const metadata: Metadata = { title: 'Club directory' };

const params = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  region: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
});

export default async function ClubDirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { session, approved } = await requireApprovedClubPage();
  const header = (
    <PageHeader
      eyebrow="Find clubs"
      title="Club directory"
      description="Clubs from the England Boxing club directory. Addresses are shown as listed and are unverified until RingPortal has checked them."
    />
  );
  if (!approved) {
    return (
      <>
        {header}
        <Alert tone="info" title="Available once your club is approved">
          The club directory opens to your club when RingPortal has verified your affiliation.
        </Alert>
      </>
    );
  }
  const p = params.parse(await searchParams);
  const list = await listDirectoryForClub(session, { q: p.q || undefined, region: p.region || undefined, page: p.page });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const qs = (page: number) => {
    const s = new URLSearchParams();
    if (p.q) s.set('q', p.q);
    if (p.region) s.set('region', p.region);
    if (page > 1) s.set('page', String(page));
    const str = s.toString();
    return str ? `?${str}` : '';
  };

  return (
    <>
      {header}
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-sm font-semibold text-ink">Search</label>
            <input id="q" name="q" defaultValue={p.q ?? ''} placeholder="Club name or postcode" maxLength={100} className="rp-input w-64" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="region" className="text-sm font-semibold text-ink">Region</label>
            <select id="region" name="region" defaultValue={p.region ?? ''} className="rp-input w-56">
              <option value="">All regions</option>
              {list.regions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass('secondary', 'min-h-11')}>Search</button>
          {p.q || p.region ? <Link href="/clubs" className="text-sm font-semibold">Clear</Link> : null}
        </form>
        <p className="mb-2 text-sm text-muted" aria-live="polite">
          {list.total === 0 ? 'No clubs match your search.' : `${list.total} ${list.total === 1 ? 'club' : 'clubs'}`}
        </p>
        {list.rows.length > 0 ? (
          <ul className="-mx-5 divide-y divide-line border-t border-line">
            {list.rows.map((r) => (
              <li key={r.slug}>
                <Link href={`/clubs/${r.slug}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 no-underline hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">{r.name}</span>
                    <span className="block text-sm text-muted">
                      {r.region ?? 'Region not listed'}
                      {r.postcode ? ` · ${r.postcode}` : ''}
                    </span>
                  </span>
                  <AddressStatusBadges p={r} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {pages > 1 ? (
          <nav aria-label="Directory pages" className="mt-4 flex items-center justify-between text-sm">
            {list.page > 1 ? <Link href={`/clubs${qs(list.page - 1)}`} className="font-semibold">← Previous</Link> : <span />}
            <span className="text-muted">Page {list.page} of {pages}</span>
            {list.page < pages ? <Link href={`/clubs${qs(list.page + 1)}`} className="font-semibold">Next →</Link> : <span />}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
