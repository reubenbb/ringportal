import type { Metadata } from 'next';
import Link from 'next/link';
import { BoxerForm, EMPTY_BOXER } from '@/components/boxers/boxer-form';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { Card, PageHeader } from '@/components/ui/card';
import { requireApprovedClubPage } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Add boxer' };

export default async function NewBoxerPage() {
  const { approved } = await requireApprovedClubPage();
  return (
    <>
      <Link href="/boxers" className="mb-4 inline-block text-sm font-semibold">← My boxers</Link>
      <PageHeader eyebrow="Your club" title="Add boxer" description="New boxers start as Ready. Enter the competitive record and skills bouts separately." />
      {approved ? (
        <Card>
          <BoxerForm initial={EMPTY_BOXER} />
        </Card>
      ) : (
        <NotApprovedNotice feature="Boxer management" />
      )}
    </>
  );
}
