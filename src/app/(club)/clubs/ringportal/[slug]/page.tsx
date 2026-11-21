import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BoxersSection } from '@/components/boxers/boxers-section';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { MessageButton } from '@/components/messaging/conversation-buttons';
import { ActionButton } from '@/components/ui/action-button';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { getBlockState } from '@/server/clubs/blocks';
import { getClubProfile, type ClubProfile } from '@/server/clubs/profile';
import { pendingOutgoingFor } from '@/server/transfers/service';
import { Badge, PageHeader } from '@/components/ui/card';

function ProfileCard({ p }: { p: ClubProfile | null }) {
  if (!p) return null;
  const rows = [
    ['Region', p.region],
    ['Training venue', p.trainingVenue],
    ['Website', p.website],
    ['Club email', p.contactEmail],
  ] as const;
  return (
    <Card title="About the club" className="mt-6">
      {p.about ? <p className="mb-4 whitespace-pre-wrap text-sm text-ink">{p.about}</p> : null}
      <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-words text-ink">
              {v ? (k === 'Website' ? <a href={v} rel="noopener noreferrer nofollow" target="_blank">{v}</a> : k === 'Club email' ? <a href={`mailto:${v}`}>{v}</a> : v) : <span className="text-muted">Not given</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
import { requireApprovedClubPage } from '@/server/auth/guards';
import { listApprovedClubsForClub, rosterForClubViewer } from '@/server/boxers/service';

export const metadata: Metadata = { title: 'Club profile' };

export default async function RingPortalClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Club profiles" />;
  const slug = (await params).slug;
  const club = (await listApprovedClubsForClub(session)).find((c) => c.slug === slug);
  if (!club) notFound();
  if (club.id === session.clubId) {
    return (
      <>
        <PageHeader eyebrow="Your club" title={club.name} description="This is how other clubs see your club." />
        <ProfileCard p={await getClubProfile(session, club.id)} />
        <p className="mt-2 text-sm"><Link href="/club-profile">Edit your club profile →</Link></p>
        <BoxersSection roster={await rosterForClubViewer(session, club.id)} clubName={club.name} />
        <p className="mt-4 text-sm"><Link href="/boxers">Manage your boxers →</Link></p>
      </>
    );
  }
  const [roster, profile, block] = await Promise.all([rosterForClubViewer(session, club.id), getClubProfile(session, club.id), getBlockState(session, club.id)]);
  return (
    <>
      <Link href="/clubs" className="mb-4 inline-block text-sm font-semibold">← Club directory</Link>
      <PageHeader
        eyebrow="RingPortal club"
        title={club.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {club.governingBody}
            <Badge tone="success">Verified club</Badge>
            {club.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-start gap-2">
            {block === 'none' ? <MessageButton target={{ kind: 'general', clubId: club.id }} label="Message club" variant="primary" /> : null}
            {block === 'mine' ? (
              <ActionButton endpoint={`/api/clubs/${club.id}/block`} body={{ blocked: false }} label="Unblock club" />
            ) : block === 'none' ? (
              <ActionButton endpoint={`/api/clubs/${club.id}/block`} body={{ blocked: true }} label="Block club" variant="ghost" confirm="Block this club? Neither club will be able to message, propose bouts or offer sparring to the other." />
            ) : null}
          </div>
        }
      />
      {block === 'mine' ? <Alert tone="warning" title="You have blocked this club">You cannot message this club, propose bouts or offer sparring partners until you unblock it.</Alert> : null}
      {block === 'theirs' ? <Alert tone="info" title="You cannot contact this club">This club is not accepting messages or proposals from your club.</Alert> : null}
      <ProfileCard p={profile} />
      <BoxersSection
        roster={roster}
        clubName={club.name}
        showActions={block === 'none'}
        transferRequested={roster?.length ? [...(await pendingOutgoingFor(session, roster.map((b) => b.id)))] : []}
      />
    </>
  );
}
