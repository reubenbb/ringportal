import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BoxersSection } from '@/components/boxers/boxers-section';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { MessageButton } from '@/components/messaging/conversation-buttons';
import { Badge, PageHeader } from '@/components/ui/card';
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
        <BoxersSection roster={await rosterForClubViewer(session, club.id)} clubName={club.name} />
        <p className="mt-4 text-sm"><Link href="/boxers">Manage your boxers →</Link></p>
      </>
    );
  }
  const roster = await rosterForClubViewer(session, club.id);
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
        actions={<MessageButton target={{ kind: 'general', clubId: club.id }} label="Message club" variant="primary" />}
      />
      <BoxersSection roster={roster} clubName={club.name} showActions />
    </>
  );
}
