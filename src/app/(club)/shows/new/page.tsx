import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { ShowForm } from '@/components/shows/forms';
import { PageHeader } from '@/components/ui/card';
import { londonParts } from '@/lib/shows';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { getShow } from '@/server/shows/service';

export const metadata: Metadata = { title: 'List a show' };

export default async function ShowFormPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Shows" />;
  const edit = (await searchParams).edit;
  let initial;
  if (edit) {
    const found = z.uuid().safeParse(edit).success ? await getShow(session, edit) : null;
    if (!found || !found.show.mine) notFound();
    const s = found.show;
    initial = { ...londonParts(s.startsAt), name: s.name, venue: s.venue, postcode: s.postcode, contactRoute: s.contactRoute ?? '', requirements: s.requirements ?? '', info: s.info ?? '', listedPublicly: s.listedPublicly };
  }
  return (
    <>
      <Link href={edit ? `/shows/${edit}` : '/shows'} className="mb-4 inline-block text-sm font-semibold">← {edit ? 'Back to show' : 'Shows'}</Link>
      <PageHeader eyebrow="Shows" title={edit ? 'Edit show' : 'List a show'} description="Verified clubs see the full details. The public calendar shows only the name, date, host club, venue and postcode area." />
      <ShowForm showId={edit} initial={initial} />
    </>
  );
}
