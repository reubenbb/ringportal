import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { CLUB_STATUS, formatDate } from '@/lib/club-status';
import { requireClubPage } from '@/server/auth/guards';
import { getClubOverview } from '@/server/club/queries';
import { ClaimForm } from '@/components/clubs/claim-form';
import { notificationSummary } from '@/server/messaging/service';
import { listProposals } from '@/server/proposals/service';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/proposals';

export const metadata: Metadata = { title: 'Overview' };

export default async function DashboardPage() {
  const session = await requireClubPage();
  const club = await getClubOverview(session);
  if (!club) return <Alert tone="danger">We could not load your club. Sign out and sign in again.</Alert>;
  const status = CLUB_STATUS[club.status];
  const approved = club.status === 'approved';
  const [summary, waiting] = approved ? await Promise.all([notificationSummary(session), listProposals(session, 'action')]) : [null, null];

  return (
    <>
      <PageHeader eyebrow="Club overview" title={club.name} description="Your club's verification status and account details." />
      <div className="flex flex-col gap-6">
        {club.isDemo ? (
          <Alert tone="warning" title="Demonstration club">
            This club and its data exist for testing only. It is not a real or verified club.
          </Alert>
        ) : null}
        {club.status !== 'approved' ? (
          <Alert tone={status.tone === 'danger' ? 'danger' : 'info'} title={status.label}>
            {status.explain}
            {club.statusReason ? <> Reason: {club.statusReason}</> : null}
          </Alert>
        ) : null}
        {summary && waiting ? (
          <Card title="Needs your attention" description="Updated as other clubs respond.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Link href="/proposals?tab=action" className="rounded-md border border-line px-4 py-3 text-ink no-underline hover:bg-surface-2">
                <p className="rp-eyebrow">Bout proposals</p>
                <p className="rp-display mt-1 text-3xl tabular-nums">{summary.proposalsNeedingAction}</p>
                <p className="text-sm text-muted">{summary.proposalsNeedingAction === 1 ? 'proposal needs' : 'proposals need'} your response or confirmation</p>
              </Link>
              <Link href="/messages" className="rounded-md border border-line px-4 py-3 text-ink no-underline hover:bg-surface-2">
                <p className="rp-eyebrow">Messages</p>
                <p className="rp-display mt-1 text-3xl tabular-nums">{summary.unreadMessages}</p>
                <p className="text-sm text-muted">
                  unread {summary.unreadMessages === 1 ? 'message' : 'messages'}
                  {summary.unreadConversations > 1 ? ` in ${summary.unreadConversations} conversations` : ''}
                </p>
              </Link>
            </div>
            {waiting.items.length ? (
              <ul className="mt-4 divide-y divide-line border-t border-line">
                {waiting.items.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <Link href={`/proposals/${p.id}`} className="flex flex-wrap items-center gap-2 py-2.5 text-sm text-ink no-underline hover:text-link">
                      <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                      <span className="font-semibold">
                        {p.myBoxer?.displayName ?? 'Boxer'} v {p.theirBoxer?.displayName ?? 'Boxer'}
                      </span>
                      <span className="text-muted">· {p.otherClub.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Verification">
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted">Status</dt>
              <dd>
                <Badge tone={status.tone}>{status.label}</Badge>
              </dd>
              <dt className="text-muted">Since</dt>
              <dd className="text-ink">{formatDate(club.statusChangedAt)}</dd>
              <dt className="text-muted">Governing body</dt>
              <dd className="text-ink">{club.governingBody}</dd>
              <dt className="text-muted">Affiliation number</dt>
              <dd className="text-ink">{club.affiliationNumber ?? 'Not recorded'}</dd>
              <dt className="text-muted">Affiliation expires</dt>
              <dd className="text-ink">{club.affiliationExpiresOn ? formatDate(club.affiliationExpiresOn) : 'Not recorded'}</dd>
            </dl>
          </Card>
          <Card title="England Boxing directory" description="Link your club to its record in the England Boxing directory.">
            {club.claim && club.claim.status !== 'rejected' ? (
              <p className="text-sm text-ink">
                <Badge tone={club.claim.status === 'approved' ? 'success' : 'warning'}>{club.claim.status === 'approved' ? 'Linked' : 'Claim waiting for review'}</Badge>{' '}
                {approved ? <Link href={`/clubs/${club.claim.directorySlug}`}>{club.claim.directoryName}</Link> : club.claim.directoryName}
              </p>
            ) : (
              <>
                {club.claim ? <p className="mb-3 text-sm text-muted">Your claim on {club.claim.directoryName} was not approved. You can claim a different record.</p> : null}
                {club.isDemo ? <p className="text-sm text-muted">Demonstration clubs cannot claim a real club’s record.</p> : <ClaimForm />}
              </>
            )}
            <p className="mt-3 text-sm text-muted">Region: <span className="text-ink">{club.region ?? 'Not recorded'}</span></p>
          </Card>
          <Card title="Club login" description="One shared login for your authorised club staff.">
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted">Email</dt>
              <dd className="break-all text-ink">{session.email}</dd>
            </dl>
            <Link href="/account" className="mt-4 inline-block text-sm font-semibold">
              Manage password and signed-in devices →
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
