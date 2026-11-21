import type { Metadata } from 'next';
import Link from 'next/link';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { ClubProfileForm } from '@/components/clubs/profile-form';
import { ActionButton } from '@/components/ui/action-button';
import { Card, PageHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/club-status';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { listMyBlocks } from '@/server/clubs/blocks';
import { getClubProfile } from '@/server/clubs/profile';
import { logoVersion } from '@/server/clubs/logo';
import { LogoUpload } from '@/components/clubs/logo-upload';

export const metadata: Metadata = { title: 'Club profile' };

export default async function ClubProfilePage() {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Your club profile" />;
  const [profile, blocks, logo] = await Promise.all([getClubProfile(session, session.clubId), listMyBlocks(session), logoVersion(session, session.clubId)]);
  return (
    <>
      <PageHeader
        eyebrow="Your club"
        title="Club profile"
        description="Shown to other verified clubs on your club’s page. Never shown publicly."
        actions={<Link href={`/clubs/ringportal/${session.clubSlug}`} className="text-sm font-semibold">See how other clubs see it →</Link>}
      />
      <div className="flex flex-col gap-6">
        <Card title="Logo">
          <LogoUpload clubId={session.clubId} name={session.clubName} version={logo} />
        </Card>
        <Card title="Profile details">
          <ClubProfileForm initial={profile ?? { region: null, about: null, website: null, contactEmail: null, trainingVenue: null }} />
          <p className="mt-4 text-sm text-muted">Region: <span className="text-ink">{profile?.region ?? 'Not recorded'}</span>. To change your club’s name, region or affiliation, contact a RingPortal administrator.</p>
        </Card>
        <Card title="Blocked clubs" description="Blocked clubs cannot message you, propose bouts or offer sparring partners, and you do not see each other’s boxers in matchmaking. They are not told that you blocked them.">
          {blocks.length === 0 ? (
            <p className="text-sm text-muted">You have not blocked any clubs.</p>
          ) : (
            <ul className="divide-y divide-line">
              {blocks.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-ink"><strong>{b.name}</strong> <span className="text-muted">· blocked {formatDate(b.blockedAt)}</span></span>
                  <ActionButton endpoint={`/api/clubs/${b.id}/block`} body={{ blocked: false }} label="Unblock" compact />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
