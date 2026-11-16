import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { AddressVerify } from '@/components/admin/address-verify';
import { ProfileView } from '@/components/directory/profile-view';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { formatDateTime } from '@/lib/club-status';
import { requireAdminPage } from '@/server/auth/guards';
import { getDirectoryProfileForAdmin } from '@/server/directory/profiles';
import { BoxersSection } from '@/components/boxers/boxers-section';
import { listApprovedClubsForAdmin, rosterForAdmin } from '@/server/boxers/service';

export const metadata: Metadata = { title: 'Directory club' };

const ACTION_LABEL: Record<string, string> = {
  'directory.address_verified': 'Address verified',
  'directory.address_unverified': 'Address marked unverified',
  'directory.address_conflict': 'Import kept verified address (source differed)',
};

export default async function AdminDirectoryClubPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await getDirectoryProfileForAdmin(id.data);
  if (!data) notFound();
  const { profile: p, history } = data;
  const linked = p.clubId ? (await listApprovedClubsForAdmin()).find((c) => c.id === p.clubId) : undefined;
  const roster = linked ? await rosterForAdmin(linked.id) : null;

  return (
    <>
      <Link href="/admin/directory" className="mb-4 inline-block text-sm font-semibold">
        ← Club directory
      </Link>
      <PageHeader eyebrow="Directory profile" title={p.name} description={`${p.region ?? 'Region not listed'} · England Boxing ID ${p.sourceRef}`} />
      <ProfileView p={p} addressAction={<AddressVerify key={`${p.id}-${p.addressStatus}`} id={p.id} status={p.addressStatus} hasAddress={Boolean(p.address)} />} />
      <BoxersSection roster={roster} clubName={p.name} />
      <Card title="Verification history" className="mt-6">
        {history.length === 0 ? (
          <p className="text-sm text-muted">No changes since import. First imported {formatDateTime(p.firstImportedAt)}.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {history.map((h, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-l-2 border-line pl-3 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={h.action.endsWith('verified') && !h.action.endsWith('unverified') ? 'success' : 'neutral'}>{ACTION_LABEL[h.action] ?? h.action}</Badge>
                  <span className="text-muted">{formatDateTime(h.occurredAt)}</span>
                  {h.actor ? <span className="text-muted">by {h.actor}</span> : null}
                </span>
                {h.reason ? <span className="text-ink">“{h.reason}”</span> : null}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
