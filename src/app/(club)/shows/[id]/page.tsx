import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { MessageButton } from '@/components/messaging/conversation-buttons';
import { RequestCard } from '@/components/shows/request-card';
import { ActionButton } from '@/components/ui/action-button';
import { Alert } from '@/components/ui/alert';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { fitsRequest, formatShowDate, formatShowTime } from '@/lib/shows';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { ownBoxersForProposal } from '@/server/proposals/service';
import { getShow } from '@/server/shows/service';

export const metadata: Metadata = { title: 'Show' };

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Shows" />;
  const id = z.uuid().safeParse((await params).id);
  const found = id.success ? await getShow(session, id.data) : null;
  if (!found) notFound();
  const { show: s, requests } = found;
  const own = s.mine ? [] : await ownBoxersForProposal(session);
  return (
    <>
      <Link href="/shows" className="mb-4 inline-block text-sm font-semibold">← Shows</Link>
      <PageHeader
        eyebrow={s.mine ? 'Your show' : 'Show'}
        title={s.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {formatShowDate(s.startsAt)}, {formatShowTime(s.startsAt)}
            {s.status === 'cancelled' ? <Badge tone="danger">Cancelled</Badge> : null}
            {s.host.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
            {s.mine ? <Badge tone={s.listedPublicly ? 'success' : 'neutral'}>{s.listedPublicly ? 'On the public calendar' : 'Verified clubs only'}</Badge> : null}
          </span>
        }
        actions={
          s.mine ? (
            <div className="flex flex-wrap gap-2">
              <Link href={`/shows/new?edit=${s.id}`} className={buttonClass('secondary')}>Edit</Link>
              {s.status === 'scheduled' ? (
                <ActionButton endpoint={`/api/shows/${s.id}`} body={{ status: 'cancelled' }} label="Cancel show" variant="danger" confirm="Mark this show as cancelled?" />
              ) : (
                <ActionButton endpoint={`/api/shows/${s.id}`} body={{ status: 'scheduled' }} label="Reinstate show" />
              )}
            </div>
          ) : (
            <MessageButton target={{ kind: 'general', clubId: s.clubId }} label="Message host club" variant="primary" />
          )
        }
      />
      <div className="flex flex-col gap-6">
        {s.status === 'cancelled' ? <Alert tone="danger" title="This show has been cancelled" /> : null}
        <Card title="Details">
          <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-4 gap-y-2.5 text-sm">
            <dt className="text-muted">Host club</dt>
            <dd className="text-ink">{s.mine ? s.host.name : <Link href={`/clubs/ringportal/${s.host.slug}`}>{s.host.name}</Link>}</dd>
            <dt className="text-muted">Venue</dt>
            <dd className="text-ink">{s.venue}, {s.postcode}</dd>
            <dt className="text-muted">Boxers and weights needed</dt>
            <dd className="whitespace-pre-wrap text-ink">{s.requirements ?? <span className="text-muted">Not specified</span>}</dd>
            <dt className="text-muted">Contact</dt>
            <dd className="whitespace-pre-wrap text-ink">{s.contactRoute ?? 'Message the host club through RingPortal.'}</dd>
            {s.info ? (
              <>
                <dt className="text-muted">Additional information</dt>
                <dd className="whitespace-pre-wrap text-ink">{s.info}</dd>
              </>
            ) : null}
          </dl>
        </Card>
        <Card title="Opponent requests for this show" actions={s.mine ? <Link href={`/shows/requests/new?show=${s.id}`} className="text-sm font-semibold">Add a request →</Link> : undefined}>
          {requests.length === 0 ? (
            <p className="text-sm text-muted">{s.mine ? 'You have not published any opponent requests for this show.' : 'The host club has no open opponent requests for this show.'}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {requests.map((r) => <RequestCard key={r.id} r={r} fits={own.filter((b) => fitsRequest(b, r)).map((b) => b.displayName)} />)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
