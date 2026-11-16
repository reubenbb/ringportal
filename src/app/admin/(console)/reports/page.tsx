import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui/card';
import { formatDateTime } from '@/lib/club-status';
import { requireAdminPage } from '@/server/auth/guards';
import { listReports } from '@/server/reports/service';

export const metadata: Metadata = { title: 'Reports' };

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireAdminPage();
  const status = (await searchParams).view === 'resolved' ? 'closed' : 'open';
  const rows = await listReports(status);
  return (
    <>
      <PageHeader eyebrow="Platform administration" title="Reports" description="Conversations reported by clubs. Opening a report shows the conversation, and that access is recorded in the audit log." />
      <nav aria-label="Report views" className="mb-4 flex gap-1">
        {([['open', 'Open', '/admin/reports'], ['closed', 'Resolved', '/admin/reports?view=resolved']] as const).map(([s, label, href]) => (
          <Link key={s} href={href} aria-current={status === s ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm font-semibold ${status === s ? 'bg-nav-active text-link' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>{label}</Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{status === 'open' ? 'No open reports.' : 'No resolved reports.'}</p>
        ) : (
          <ul className="-mx-5 -my-4 divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/admin/reports/${r.id}`} className="block px-5 py-3.5 text-ink no-underline hover:bg-surface-2">
                  <p className="font-semibold">{r.reporterClub} <span className="font-normal text-muted">reported a conversation with</span> {r.otherClub}</p>
                  <p className="truncate text-sm text-muted">{formatDateTime(r.createdAt)} · {r.reason}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
