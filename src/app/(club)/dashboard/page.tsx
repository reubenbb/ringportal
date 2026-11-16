import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { CLUB_STATUS, formatDate } from '@/lib/club-status';
import { requireClubPage } from '@/server/auth/guards';
import { getClubOverview } from '@/server/club/queries';

export const metadata: Metadata = { title: 'Overview' };

export default async function DashboardPage() {
  const session = await requireClubPage();
  const club = await getClubOverview(session);
  if (!club) return <Alert tone="danger">We could not load your club. Sign out and sign in again.</Alert>;
  const status = CLUB_STATUS[club.status];

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
