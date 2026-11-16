import type { Metadata } from 'next';
import Link from 'next/link';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { SparringRequestForm } from '@/components/sparring/forms';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/card';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { ownBoxersForProposal } from '@/server/proposals/service';

export const metadata: Metadata = { title: 'Request a sparring partner' };

export default async function NewSparringPage() {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Sparring" />;
  const own = await ownBoxersForProposal(session);
  return (
    <>
      <Link href="/sparring" className="mb-4 inline-block text-sm font-semibold">← Sparring</Link>
      <PageHeader eyebrow="Sparring" title="Request a sparring partner" description="For one boxer. Other verified clubs can propose one of their boxers, and you approve or decline." />
      {own.length === 0 ? (
        <Alert tone="info" title="Add a boxer first">Your club has no active boxers. <Link href="/boxers/new">Add a boxer</Link>.</Alert>
      ) : (
        <SparringRequestForm boxers={own.map((b) => ({ id: b.id, displayName: b.displayName, ageYears: b.ageYears, weightKg: b.weightKg }))} />
      )}
    </>
  );
}
