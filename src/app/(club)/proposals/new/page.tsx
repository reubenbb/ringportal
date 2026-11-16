import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { ProposalForm } from '@/components/proposals/proposal-form';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/card';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { opponentForProposal, ownBoxersForProposal } from '@/server/proposals/service';

export const metadata: Metadata = { title: 'New bout proposal' };

export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ boxer?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Bout proposals" />;
  const boxerId = z.uuid().safeParse((await searchParams).boxer);
  const opponent = boxerId.success ? await opponentForProposal(session, boxerId.data) : null;

  if (!opponent) {
    return (
      <>
        <PageHeader eyebrow="Bout proposals" title="New bout proposal" />
        <Alert tone="info" title="Choose an opponent first">
          Open a verified club in the <Link href="/clubs">Club directory</Link> and choose <strong>Propose bout</strong> next to one of their boxers.
        </Alert>
      </>
    );
  }

  const own = await ownBoxersForProposal(session);
  return (
    <>
      <Link href={`/clubs/ringportal/${opponent.club.slug}`} className="mb-4 inline-block text-sm font-semibold">
        ← {opponent.club.name}
      </Link>
      <PageHeader
        eyebrow="New bout proposal"
        title={`Propose a bout with ${opponent.boxer.displayName}`}
        description={`Sent to ${opponent.club.name}. They can accept, decline or propose changes. Every change is kept as a new version.`}
      />
      {own.length === 0 ? (
        <Alert tone="info" title="Add a boxer first">
          Your club has no active boxers. <Link href="/boxers/new">Add a boxer</Link> to propose a bout.
        </Alert>
      ) : (
        <ProposalForm opponent={opponent.boxer} opponentClubName={opponent.club.name} ownBoxers={own} />
      )}
    </>
  );
}
