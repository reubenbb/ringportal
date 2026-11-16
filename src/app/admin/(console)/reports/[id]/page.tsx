import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ReasonForm } from '@/components/messaging/report-form';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { formatDateTime } from '@/lib/club-status';
import { pseudonymise } from '@/server/auth/crypto';
import { requireAdminPage } from '@/server/auth/guards';
import { getReportForAdmin } from '@/server/reports/service';

export const metadata: Metadata = { title: 'Report' };

export default async function AdminReportPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const id = z.uuid().safeParse((await params).id);
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const r = id.success ? await getReportForAdmin(admin, id.data, { ipHash: pseudonymise(`ip:${ip}`) }) : null;
  if (!r) notFound();
  return (
    <>
      <Link href="/admin/reports" className="mb-4 inline-block text-sm font-semibold">← Reports</Link>
      <PageHeader
        eyebrow="Report"
        title={`${r.reporter.name} v ${r.other.name}`}
        description={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={r.status === 'open' ? 'warning' : 'success'}>{r.status === 'open' ? 'Open' : 'Resolved'}</Badge> Reported {formatDateTime(r.createdAt)}</span>}
      />
      <div className="flex flex-col gap-6">
        <Card title="What was reported" description={<>By <Link href={`/admin/clubs/${r.reporter.id}`}>{r.reporter.name}</Link>, about a conversation with <Link href={`/admin/clubs/${r.other.id}`}>{r.other.name}</Link>.</>}>
          <p className="whitespace-pre-wrap text-sm text-ink">{r.reason}</p>
        </Card>
        <Card title="Conversation" description="Most recent 200 messages. Your viewing of this conversation has been recorded.">
          {r.messages.length === 0 ? <p className="text-sm text-muted">No messages.</p> : (
            <ol className="flex flex-col gap-2 text-sm">
              {r.messages.map((m) => (
                <li key={m.id} className="rounded-md border border-line px-3 py-2">
                  <p className="text-xs text-muted"><strong className="text-ink">{m.fromReporter ? r.reporter.name : r.other.name}</strong> · {formatDateTime(m.createdAt)}</p>
                  <p className="whitespace-pre-wrap break-words text-ink">{m.body}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title="Resolution">
          {r.status === 'closed' ? (
            <p className="whitespace-pre-wrap text-sm text-ink">{r.resolution} <span className="text-muted">({r.resolvedAt ? formatDateTime(r.resolvedAt) : ''})</span></p>
          ) : (
            <ReasonForm endpoint={`/api/admin/reports/${r.id}`} field="resolution" openLabel="Resolve this report" label="What was done" hint="Recorded in the audit log. To act against a club, use Suspend on the club’s page." submitLabel="Mark as resolved" doneText="Report resolved." />
          )}
        </Card>
      </div>
    </>
  );
}
