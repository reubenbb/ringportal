import type { Metadata } from 'next';
import Link from 'next/link';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { ActionButton } from '@/components/ui/action-button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { TRANSFER_STATUS_LABEL, type TransferStatus } from '@/lib/transfers';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { listTransfers, type TransferRow } from '@/server/transfers/service';

export const metadata: Metadata = { title: 'Boxer transfers' };

const TONE: Record<TransferStatus, 'warning' | 'success' | 'neutral'> = { pending: 'warning', approved: 'success', declined: 'neutral', cancelled: 'neutral' };
const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });

function Rows({ items, empty }: { items: TransferRow[]; empty: string }) {
  if (!items.length) return <p className="py-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="-mx-5 -my-4 divide-y divide-line">
      {items.map((t) => {
        const name = t.boxerName ?? 'Boxer no longer listed';
        return (
          <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                {t.direction === 'incoming' && t.status === 'approved' ? name : t.direction === 'outgoing' && t.status === 'approved' ? <Link href={`/boxers/${t.boxerId}`}>{name}</Link> : name}
                <Badge tone={TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Badge>
              </p>
              <p className="text-sm text-muted">
                {t.direction === 'incoming' ? 'Requested by ' : 'From '}
                {t.otherClub ? <Link href={`/clubs/ringportal/${t.otherClub.slug}`}>{t.otherClub.name}</Link> : 'a club no longer listed'}
                {` · ${date(t.createdAt)}`}
                {t.decidedAt ? ` · decided ${date(t.decidedAt)}` : ''}
              </p>
              {t.note ? <p className="mt-1 max-w-2xl whitespace-pre-wrap text-sm text-ink">“{t.note}”</p> : null}
            </div>
            {t.status === 'pending' ? (
              <div className="flex flex-wrap items-start gap-2">
                {t.direction === 'incoming' ? (
                  <>
                    <ActionButton
                      endpoint={`/api/transfers/${t.id}`}
                      body={{ action: 'approve' }}
                      label="Approve transfer"
                      variant="primary"
                      compact
                      confirm={`${name} and their date of birth and medical status will move to the other club. Your notes stay behind.`}
                    />
                    <ActionButton endpoint={`/api/transfers/${t.id}`} body={{ action: 'decline' }} label="Decline" variant="ghost" compact />
                  </>
                ) : (
                  <ActionButton endpoint={`/api/transfers/${t.id}`} body={{ action: 'cancel' }} label="Cancel request" variant="ghost" compact confirm="Cancel this transfer request?" />
                )}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default async function TransfersPage() {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Boxer transfers" />;
  const rows = await listTransfers(session);
  const incoming = rows.filter((r) => r.direction === 'incoming');
  const outgoing = rows.filter((r) => r.direction === 'outgoing');
  return (
    <>
      <PageHeader
        eyebrow="Boxers"
        title="Boxer transfers"
        description="A club asks for a boxer from another club’s profile. The boxer’s current club approves or declines. Approved boxers arrive marked Inactive, so check their record before making them available."
      />
      <Card title="Requests for your boxers" description="Other clubs asking for one of your boxers." className="mt-6">
        <Rows items={incoming} empty="No requests for your boxers." />
      </Card>
      <Card title="Your requests" description="Boxers you have asked other clubs to transfer to you." className="mt-6">
        <Rows items={outgoing} empty="You have not requested any transfers. Use “Request transfer” on another club’s boxer list." />
      </Card>
      <p className="mt-4 text-xs text-muted">
        A transfer cannot be approved while the boxer has an open bout proposal, a confirmed bout, open sparring or an open opponent request. Under-18s need your club to confirm parent or guardian consent before they can be made available.
      </p>
    </>
  );
}
