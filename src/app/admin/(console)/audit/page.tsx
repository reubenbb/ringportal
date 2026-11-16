import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { formatDateTime } from '@/lib/club-status';
import { listAudit } from '@/server/admin/queries';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Audit log' };

const params = z.object({
  before: z.coerce.number().int().positive().optional().catch(undefined),
  action: z.string().trim().max(64).regex(/^[a-z_.]*$/).optional().catch(undefined),
});

function tone(action: string) {
  if (/failed|rate_limited|invalid/.test(action)) return 'warning' as const;
  if (action.startsWith('admin.')) return 'gold' as const;
  return 'neutral' as const;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdminPage();
  const { before, action } = params.parse(await searchParams);
  const page = await listAudit({ before, action: action || undefined, limit: 50 });
  const qs = (b?: number) => {
    const p = new URLSearchParams();
    if (action) p.set('action', action);
    if (b) p.set('before', String(b));
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return (
    <>
      <PageHeader eyebrow="Platform administration" title="Audit log" description="Append-only record of security and administrative events. Newest first." />
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="action" className="text-sm font-semibold text-ink">
              Action starts with
            </label>
            <input id="action" name="action" defaultValue={action ?? ''} placeholder="e.g. admin. or club.login" pattern="[a-z_.]*" maxLength={64} className="rp-input w-64" />
          </div>
          <button type="submit" className={buttonClass('secondary', 'min-h-11')}>
            Filter
          </button>
          {action ? (
            <Link href="/admin/audit" className="text-sm font-semibold">
              Clear filter
            </Link>
          ) : null}
        </form>
        {page.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No audit events match this filter.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">Audit events</caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2 font-semibold">When</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Action</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Actor</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Club</th>
                  <th scope="col" className="px-5 py-2 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.rows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted">{formatDateTime(r.occurredAt)}</td>
                    <td className="px-2 py-2.5">
                      <Badge tone={tone(r.action)}>{r.action}</Badge>
                    </td>
                    <td className="px-2 py-2.5 text-ink">{r.actorLabel ?? r.actorType.replace('_', ' ')}</td>
                    <td className="px-2 py-2.5 text-ink">{r.clubName ?? '—'}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-muted">
                      {r.reason ? <span className="block font-sans text-ink">{r.reason}</span> : null}
                      {Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <nav aria-label="Audit log pages" className="mt-4 flex items-center justify-between">
          {before ? (
            <Link href={`/admin/audit${qs()}`} className="text-sm font-semibold">
              ← Newest
            </Link>
          ) : (
            <span />
          )}
          {page.nextBefore ? (
            <Link href={`/admin/audit${qs(page.nextBefore)}`} className="text-sm font-semibold">
              Older →
            </Link>
          ) : null}
        </nav>
      </Card>
    </>
  );
}
