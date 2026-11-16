import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { AddressVerify } from '@/components/admin/address-verify';
import { DirectoryImport } from '@/components/admin/directory-import';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, PageHeader, Stat } from '@/components/ui/card';
import { formatDateTime } from '@/lib/club-status';
import { requireAdminPage } from '@/server/auth/guards';
import { directorySummary, listDirectory, type AddressFilter } from '@/server/directory/admin';
import { DIRECTORY_SOURCE_LABEL } from '@/server/directory/normalise';

export const metadata: Metadata = { title: 'Club directory' };

const params = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  region: z.string().trim().max(120).optional().catch(undefined),
  address: z.enum(['all', 'unverified', 'verified', 'flagged', 'missing']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
});

const FILTERS: Array<{ value: AddressFilter; label: string }> = [
  { value: 'all', label: 'All addresses' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'flagged', label: 'Differs from map' },
  { value: 'missing', label: 'Missing' },
  { value: 'verified', label: 'Verified' },
];

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdminPage();
  const p = params.parse(await searchParams);
  const [summary, list] = await Promise.all([directorySummary(), listDirectory({ q: p.q || undefined, region: p.region || undefined, address: p.address, page: p.page })]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const qs = (page: number) => {
    const s = new URLSearchParams();
    if (p.q) s.set('q', p.q);
    if (p.region) s.set('region', p.region);
    if (p.address && p.address !== 'all') s.set('address', p.address);
    if (page > 1) s.set('page', String(page));
    const str = s.toString();
    return str ? `?${str}` : '';
  };

  return (
    <>
      <PageHeader
        eyebrow="Platform administration"
        title="Club directory"
        description={
          <>
            Club records imported from the {DIRECTORY_SOURCE_LABEL}. Directory profiles are not RingPortal accounts and cannot sign in. Addresses stay unverified until an administrator checks them.
          </>
        }
        actions={admin.role === 'owner' ? <DirectoryImport hasData={summary.total > 0} /> : undefined}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Directory clubs" value={summary.total} hint={summary.lastImport?.finishedAt ? `Last import ${formatDateTime(summary.lastImport.finishedAt)}` : 'Not imported yet'} />
        <Stat label="Addresses verified" value={summary.verified} />
        <Stat label="Unverified addresses" value={summary.unverified} hint={`${summary.flagged} differ from map`} />
        <Stat label="No address" value={summary.missing} />
      </div>

      <Card className="mt-6">
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="q" className="text-sm font-semibold text-ink">Search</label>
            <input id="q" name="q" defaultValue={p.q ?? ''} placeholder="Club name, postcode or EB id" maxLength={100} className="rp-input w-64" />
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
          <div className="flex flex-col gap-1.5">
            <label htmlFor="address" className="text-sm font-semibold text-ink">Address</label>
            <select id="address" name="address" defaultValue={p.address ?? 'all'} className="rp-input w-48">
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <button type="submit" className={buttonClass('secondary', 'min-h-11')}>Apply</button>
          {p.q || p.region || (p.address && p.address !== 'all') ? (
            <Link href="/admin/directory" className="text-sm font-semibold">Clear filters</Link>
          ) : null}
        </form>

        <p className="mb-3 text-sm text-muted" aria-live="polite">
          {list.total === 0 ? 'No clubs match these filters.' : `Showing ${(list.page - 1) * list.pageSize + 1}–${Math.min(list.page * list.pageSize, list.total)} of ${list.total}`}
        </p>

        {list.rows.length > 0 ? (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <caption className="sr-only">Directory clubs</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2 font-semibold">Club</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Region</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Address</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Status</th>
                  <th scope="col" className="px-5 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-ink">{r.name}</p>
                      <p className="text-xs text-muted">
                        {DIRECTORY_SOURCE_LABEL} · ID {r.sourceRef}
                      </p>
                      {r.website ? (
                        <a href={r.website} rel="noopener noreferrer nofollow" target="_blank" className="text-xs break-all">
                          {r.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-ink">{r.region ?? '—'}</td>
                    <td className="max-w-xs px-2 py-3 text-ink">
                      {r.address ? (
                        <>
                          {r.address}
                          {r.postcode ? <span className="block text-muted">{r.postcode}</span> : null}
                        </>
                      ) : (
                        <span className="text-muted">No address supplied</span>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex flex-col items-start gap-1">
                        {r.address ? <Badge tone={r.addressStatus === 'verified' ? 'success' : 'warning'}>{r.addressStatus === 'verified' ? 'Verified' : 'Unverified'}</Badge> : null}
                        {r.addressFlag === 'differs_from_map' && r.addressStatus === 'unverified' ? <Badge tone="danger">Differs from map</Badge> : null}
                        <Badge tone="neutral">{r.claimStatus === 'claimed' ? 'Claimed' : 'Unclaimed'}</Badge>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <AddressVerify key={`${r.id}-${r.addressStatus}`} id={r.id} status={r.addressStatus} hasAddress={Boolean(r.address)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {pages > 1 ? (
          <nav aria-label="Directory pages" className="mt-4 flex items-center justify-between text-sm">
            {list.page > 1 ? <Link href={`/admin/directory${qs(list.page - 1)}`} className="font-semibold">← Previous</Link> : <span />}
            <span className="text-muted">Page {list.page} of {pages}</span>
            {list.page < pages ? <Link href={`/admin/directory${qs(list.page + 1)}`} className="font-semibold">Next →</Link> : <span />}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
