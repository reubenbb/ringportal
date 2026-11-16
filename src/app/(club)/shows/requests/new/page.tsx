import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { RequestForm, type RequestFormValues } from '@/components/shows/forms';
import { PageHeader } from '@/components/ui/card';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { ownBoxersForProposal } from '@/server/proposals/service';
import { getOwnRequest, listOwnShowOptions } from '@/server/shows/service';

export const metadata: Metadata = { title: 'Opponent request' };

export default async function RequestFormPage({ searchParams }: { searchParams: Promise<{ edit?: string; show?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Opponent requests" />;
  const sp = await searchParams;
  const [shows, boxers] = await Promise.all([listOwnShowOptions(session), ownBoxersForProposal(session)]);
  let initial: RequestFormValues = { showId: shows.some((s) => s.id === sp.show) ? sp.show! : '', boxerId: '', sex: '', minAge: '', maxAge: '', weightKg: '', boutType: 'competitive', experience: '', neededOn: '', location: '', requirements: '' };
  if (sp.edit) {
    const r = z.uuid().safeParse(sp.edit).success ? await getOwnRequest(session, sp.edit) : null;
    if (!r) notFound();
    initial = { showId: r.showId ?? '', boxerId: r.boxer?.id ?? '', sex: r.sex, minAge: r.minAge, maxAge: r.maxAge, weightKg: r.weightKg, boutType: r.boutType, experience: r.experience ?? '', neededOn: r.neededOn ?? '', location: r.location ?? '', requirements: r.requirements ?? '' };
  }
  return (
    <>
      <Link href="/shows?tab=mine" className="mb-4 inline-block text-sm font-semibold">← My listings</Link>
      <PageHeader eyebrow="Opponent requests" title={sp.edit ? 'Edit opponent request' : 'Request an opponent'} description="Seen by verified clubs only. It stays open until you close it." />
      <RequestForm requestId={sp.edit} initial={initial} shows={shows} boxers={boxers.map((b) => ({ id: b.id, displayName: b.displayName, sex: b.sex, ageYears: b.ageYears, weightKg: b.weightKg }))} />
    </>
  );
}
