import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { BoxersSection } from '@/components/boxers/boxers-section';
import { ClubDecision } from '@/components/clubs/club-decision';
import { ActionButton } from '@/components/ui/action-button';
import { formatKg } from '@/lib/boxers';
import { STATUS_LABEL, STATUS_TONE, formatProposalDate, type ProposalStatus } from '@/lib/proposals';
import { RegionSelect } from '@/components/clubs/region-select';
import { Alert } from '@/components/ui/alert';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { actionsFor } from '@/lib/club-admin';
import { CLUB_STATUS, formatDate, formatDateTime } from '@/lib/club-status';
import { requireAdminPage } from '@/server/auth/guards';
import { rosterForAdmin } from '@/server/boxers/service';
import { getClubForAdmin, listRegionsForAdmin } from '@/server/clubs/admin';

export const metadata: Metadata = { title: 'Club' };

export default async function AdminClubPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const c = await getClubForAdmin(id.data);
  if (!c) notFound();
  const status = CLUB_STATUS[c.status];
  const pending = c.claims.find((k) => k.status === 'pending');
  const expired = Boolean(c.affiliationExpiresOn && c.affiliationExpiresOn < new Date().toISOString().slice(0, 10));
  return (
    <>
      <Link href="/admin/clubs" className="mb-4 inline-block text-sm font-semibold">← Clubs</Link>
      <PageHeader
        eyebrow="Club"
        title={c.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {c.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
            <span>since {formatDate(c.statusChangedAt)}</span>
          </span>
        }
      />
      <div className="flex flex-col gap-6">
        {expired && c.status === 'approved' ? (
          <Alert tone="warning" title="Affiliation date has passed">
            Recorded expiry: {formatDate(c.affiliationExpiresOn)}. Check the club’s affiliation and require re-verification if it has lapsed.
          </Alert>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Registration details">
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted">Governing body</dt>
              <dd className="text-ink">{c.governingBody}</dd>
              <dt className="text-muted">Region</dt>
              <dd><RegionSelect clubId={c.id} value={c.region} regions={await listRegionsForAdmin()} /></dd>
              <dt className="text-muted">Affiliation number</dt>
              <dd className="text-ink">{c.affiliationNumber ?? 'Not given'}</dd>
              <dt className="text-muted">Affiliation expires</dt>
              <dd className="text-ink">{c.affiliationExpiresOn ? formatDate(c.affiliationExpiresOn) : 'Not recorded'}</dd>
              <dt className="text-muted">Registered</dt>
              <dd className="text-ink">{formatDateTime(c.createdAt)}</dd>
              <dt className="text-muted">Club login</dt>
              <dd className="break-words text-ink">
                {c.logins.map((l) => (
                  <span key={l.email} className="block">
                    {l.email} <span className="text-muted">· {l.status} · last sign-in {l.lastLoginAt ? formatDateTime(l.lastLoginAt) : 'never'}</span>
                  </span>
                ))}
              </dd>
              {c.statusReason ? (
                <>
                  <dt className="text-muted">Current reason</dt>
                  <dd className="whitespace-pre-wrap text-ink">{c.statusReason}</dd>
                </>
              ) : null}
            </dl>
          </Card>
          <Card title="Activity" description="Counts only. Proposal terms and messages are private to the clubs involved.">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {([['Active boxers', c.counts.boxers], ['Bout proposals', c.counts.proposals], ['Confirmed bouts', c.counts.confirmedBouts], ['Conversations', c.counts.conversations]] as const).map(([k, v]) => (
                <div key={k} className="rounded-md border border-line px-3 py-2">
                  <dt className="text-muted">{k}</dt>
                  <dd className="rp-display text-2xl tabular-nums text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <Card title="Directory claim" description="A claim links this club to its England Boxing directory record. It takes effect only when you approve it.">
          {c.claims.length === 0 ? (
            <p className="text-sm text-muted">This club did not claim a directory record.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {c.claims.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2.5 text-sm">
                  <span className="text-ink">
                    <Link href={`/admin/directory/${k.directoryClubId}`} className="font-semibold">{k.directoryName}</Link>
                    <span className="text-muted"> · {[k.directoryRegion, k.directoryPostcode].filter(Boolean).join(' · ') || 'No region recorded'} · requested {formatDate(k.createdAt)}</span>
                  </span>
                  <span className="flex gap-2">
                    {k.directoryClaimedByOther ? <Badge tone="danger">Already linked to another club</Badge> : null}
                    <Badge tone={k.status === 'approved' ? 'success' : k.status === 'rejected' ? 'danger' : 'warning'}>{k.status === 'pending' ? 'Pending' : k.status === 'approved' ? 'Approved' : 'Turned down'}</Badge>
                    {k.status === 'pending' && c.status === 'approved' ? (
                      <>
                        {k.directoryClaimedByOther ? null : <ActionButton endpoint={`/api/admin/claims/${k.id}`} body={{ approve: true }} label="Approve claim" variant="primary" compact />}
                        <ActionButton endpoint={`/api/admin/claims/${k.id}`} body={{ approve: false }} label="Turn down" compact />
                      </>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Decision" description="Every decision is recorded in the audit log with your name.">
          <ClubDecision clubId={c.id} actions={actionsFor(c.status)} hasPendingClaim={Boolean(pending)} claimBlocked={Boolean(pending?.directoryClaimedByOther)} affiliationExpiresOn={c.affiliationExpiresOn} />
        </Card>

        {c.status === 'approved' ? <BoxersSection roster={await rosterForAdmin(c.id)} clubName={c.name} /> : null}

        <Card title="Bout proposals" description="Most recent 25, with current terms. Messages are not shown here; they are read only through a report.">
          {c.proposals.length === 0 ? (
            <p className="text-sm text-muted">No proposals involve this club.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Bout proposals involving this club</caption>
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th scope="col" className="px-5 py-2 font-semibold">Status</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Boxers</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Other club</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Date</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Weight</th>
                    <th scope="col" className="px-5 py-2 font-semibold">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {c.proposals.map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-2"><Badge tone={STATUS_TONE[p.status as ProposalStatus]}>{STATUS_LABEL[p.status as ProposalStatus]}</Badge> <span className="text-xs text-muted">v{p.version}</span></td>
                      <td className="px-2 py-2 text-ink">{p.boxers}</td>
                      <td className="px-2 py-2 text-ink">{p.otherClub}</td>
                      <td className="px-2 py-2 text-ink">{formatProposalDate(p.proposedDate)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink">{formatKg(p.weightKg)}</td>
                      <td className="px-5 py-2 text-muted">{formatDateTime(p.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Decision history">
          {c.history.length === 0 ? (
            <p className="text-sm text-muted">No decisions recorded yet.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {c.history.map((h, i) => (
                <li key={i} className="flex flex-wrap gap-x-3">
                  <time dateTime={h.occurredAt} className="w-40 shrink-0 text-muted">{formatDateTime(h.occurredAt)}</time>
                  <span className="text-ink">
                    <strong>{h.action}</strong> <span className="text-muted">by {h.actorType === 'platform_user' ? 'administrator' : 'club'}</span>
                    {h.reason ? <span className="block whitespace-pre-wrap text-muted">{h.reason}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
