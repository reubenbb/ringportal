import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ArchiveButton } from '@/components/boxers/archive-button';
import { AvailabilitySelect } from '@/components/boxers/availability-select';
import { BoxerForm } from '@/components/boxers/boxer-form';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { Alert } from '@/components/ui/alert';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, ageOn, recordLabel } from '@/lib/boxers';
import { formatDateTime } from '@/lib/club-status';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { getOwnBoxer } from '@/server/boxers/service';

export const metadata: Metadata = { title: 'Boxer' };

export default async function BoxerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; saved?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Boxer management" />;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await getOwnBoxer(session, id.data);
  if (!data) notFound();
  const { boxer: b, history } = data;
  const flags = await searchParams;
  const age = ageOn(b.dateOfBirth);
  const name = `${b.firstName} ${b.lastName}`;

  return (
    <>
      <Link href={b.archivedAt ? '/boxers?archived=1' : '/boxers'} className="mb-4 inline-block text-sm font-semibold">← My boxers</Link>
      <PageHeader
        eyebrow={b.archivedAt ? 'Archived boxer' : 'Boxer'}
        title={name}
        description={`Age ${age} · record ${recordLabel(b.competitiveWins, b.competitiveLosses, b.competitiveDraws)} · ${b.skillsBouts} skills bouts`}
      />
      <div className="flex flex-col gap-6">
        {flags.created ? <Alert tone="success" live>Boxer added. Other approved clubs can now see this boxer{age < 18 ? ' (as “' + b.firstName + ' ' + b.lastName.charAt(0) + '.”, because they are under 18)' : ''}.</Alert> : null}
        {flags.saved ? <Alert tone="success" live>Changes saved.</Alert> : null}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card title="Details">
            {b.archivedAt ? (
              <p className="text-sm text-muted">Restore this boxer to edit their details.</p>
            ) : (
              <BoxerForm
                boxerId={b.id}
                initial={{
                  firstName: b.firstName,
                  lastName: b.lastName,
                  sex: b.sex,
                  dateOfBirth: b.dateOfBirth,
                  weightKg: b.weightKg,
                  competitiveWins: b.competitiveWins,
                  competitiveLosses: b.competitiveLosses,
                  competitiveDraws: b.competitiveDraws,
                  skillsBouts: b.skillsBouts,
                  medicalStatus: b.medicalStatus ?? '',
                  notes: b.notes ?? '',
                  guardianConsentAt: b.guardianConsentAt,
                }}
              />
            )}
          </Card>
          <div className="flex flex-col gap-6">
            <Card title="Availability">
              {b.archivedAt ? <Badge tone="neutral">Archived</Badge> : <AvailabilitySelect boxerId={b.id} value={b.availability} name={name} />}
              <h3 className="mt-5 text-xs font-semibold text-muted">History</h3>
              <ol className="mt-2 flex flex-col gap-2 text-sm">
                {history.map((h, i) => (
                  <li key={i} className="flex flex-col">
                    <span className="flex items-center gap-1.5">
                      {h.fromStatus ? <><Badge tone={AVAILABILITY_TONE[h.fromStatus]}>{AVAILABILITY_LABEL[h.fromStatus]}</Badge><span aria-label="changed to">→</span></> : <span className="text-muted">Added as</span>}
                      <Badge tone={AVAILABILITY_TONE[h.toStatus]}>{AVAILABILITY_LABEL[h.toStatus]}</Badge>
                    </span>
                    <span className="text-xs text-muted">
                      {formatDateTime(h.changedAt)}
                      {h.changedBy ? ` · ${h.changedBy}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="Roster">
              <ArchiveButton boxerId={b.id} archived={Boolean(b.archivedAt)} />
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
