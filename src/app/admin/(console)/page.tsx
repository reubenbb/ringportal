import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, PageHeader, Stat } from '@/components/ui/card';
import { CLUB_STATUS, type ClubStatus } from '@/lib/club-status';
import { platformOverview, weeklyActivity } from '@/server/admin/queries';
import { requireAdminPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Admin overview' };

export default async function AdminOverviewPage() {
  await requireAdminPage();
  const [o, weeks] = await Promise.all([platformOverview(), weeklyActivity(8)]);
  const statuses = Object.keys(CLUB_STATUS) as ClubStatus[];
  return (
    <>
      <PageHeader eyebrow="Platform administration" title="Overview" description="Live counts from the platform database." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clubs" value={o.totalClubs} hint={o.demoClubs ? `${o.demoClubs} demo` : undefined} />
        <Stat label="Approved" value={o.clubsByStatus.approved ?? 0} />
        <Link href="/admin/clubs?filter=review" className="no-underline"><Stat label="Awaiting review" value={(o.clubsByStatus.submitted ?? 0) + (o.clubsByStatus.under_review ?? 0)} hint="Open the review queue →" /></Link>
        <Stat label="Audit events (24h)" value={o.auditEvents24h} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Clubs by status">
          <table className="w-full text-sm">
            <caption className="sr-only">Number of clubs in each verification status</caption>
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="pb-2 font-semibold">Status</th>
                <th scope="col" className="pb-2 text-right font-semibold">Clubs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {statuses.map((s) => (
                <tr key={s}>
                  <td className="py-2 text-ink">{CLUB_STATUS[s].label}</td>
                  <td className="py-2 text-right tabular-nums text-ink">{o.clubsByStatus[s] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Security">
          <p className="text-sm text-ink">{o.activeAdmins} active admin {o.activeAdmins === 1 ? 'account' : 'accounts'}, all protected by two-factor authentication.</p>
          <Link href="/admin/audit" className="mt-4 inline-block text-sm font-semibold">
            Review the audit log →
          </Link>
        </Card>
      </div>
      <Card title="Activity by week" description="Last 8 weeks, Monday to Sunday (UK time). Demo clubs are excluded." className="mt-6">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Platform activity per week, newest first</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-5 py-2 font-semibold">Week starting</th>
                {['Registrations', 'Approvals', 'Proposals', 'Confirmed bouts', 'Messages', 'Transfers'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-right font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {weeks.map((w, i) => (
                <tr key={w.weekStart}>
                  <th scope="row" className="px-5 py-2 text-left font-normal text-ink">
                    {new Date(`${w.weekStart}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {i === 0 ? <span className="ml-2 text-xs text-muted">(this week)</span> : null}
                  </th>
                  {[w.registrations, w.approvals, w.proposals, w.confirmedBouts, w.messages, w.transfers].map((v, j) => (
                    <td key={j} className={`px-3 py-2 text-right tabular-nums ${v ? 'text-ink' : 'text-muted'}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
