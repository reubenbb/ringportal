import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProfileView } from '@/components/directory/profile-view';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/card';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { getDirectoryProfileForClub } from '@/server/directory/profiles';
import { BoxersSection } from '@/components/boxers/boxers-section';
import { listApprovedClubsForClub, rosterForClubViewer } from '@/server/boxers/service';

export const metadata: Metadata = { title: 'Club profile' };

export default async function ClubProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) {
    return (
      <Alert tone="info" title="Available once your club is approved">
        Club profiles open to your club when RingPortal has verified your affiliation.
      </Alert>
    );
  }
  const profile = await getDirectoryProfileForClub(session, (await params).slug);
  if (!profile) notFound();
  return (
    <>
      <Link href="/clubs" className="mb-4 inline-block text-sm font-semibold">
        ← Club directory
      </Link>
      <PageHeader eyebrow="Club profile" title={profile.name} description={profile.region ?? undefined} />
      <ProfileView p={profile} />
      {await (async () => {
        const linked = profile.clubId ? (await listApprovedClubsForClub(session)).find((c) => c.id === profile.clubId) : undefined;
        return (
          <BoxersSection
            roster={linked ? await rosterForClubViewer(session, linked.id) : null}
            clubName={profile.name}
            linkedProfileHref={linked ? `/clubs/ringportal/${linked.slug}` : undefined}
          />
        );
      })()}
    </>
  );
}
