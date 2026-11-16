import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { MessageButton } from '@/components/messaging/conversation-buttons';
import { BoxerSummary } from '@/components/proposals/boxer-summary';
import { AttendanceForm, OfferPartnerForm } from '@/components/sparring/forms';
import { ActionButton } from '@/components/ui/action-button';
import { Alert } from '@/components/ui/alert';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { formatKg } from '@/lib/boxers';
import { formatDate } from '@/lib/club-status';
import { ukToday } from '@/lib/proposals';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { getSparring } from '@/server/sparring/service';

export const metadata: Metadata = { title: 'Sparring request' };
const OFFER = { pending: ['Waiting for a decision', 'warning'], approved: ['Approved partner', 'success'], declined: ['Declined', 'neutral'], withdrawn: ['Withdrawn', 'neutral'] } as const;

export default async function SparringDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Sparring" />;
  const id = z.uuid().safeParse((await params).id);
  const d = id.success ? await getSparring(session, id.data) : null;
  if (!d) notFound();
  const r = d.request;
  const partnerWithdrew = r.mine && r.status === 'arranged' && !d.approvedOfferId;
  const myApproved = d.offers.find((o) => o.status === 'approved' && (r.mine || o.byMe));
  return (
    <>
      <Link href="/sparring" className="mb-4 inline-block text-sm font-semibold">← Sparring</Link>
      <PageHeader
        eyebrow={r.mine ? 'Your sparring request' : 'Sparring request'}
        title={`Sparring partner for ${r.boxer?.displayName ?? 'a boxer'}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={r.status === 'open' ? 'success' : r.status === 'arranged' ? 'blue' : 'neutral'}>{r.status === 'open' ? 'Open' : r.status === 'arranged' ? 'Partner arranged' : 'Closed'}</Badge>
            {r.mine ? null : <span>{r.club.name}</span>}
            {r.club.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
          </span>
        }
        actions={
          r.mine ? (
            r.status === 'open' ? (
              <ActionButton endpoint={`/api/sparring/${r.id}`} body={{ action: 'close' }} label="Close request" confirm="Close this request? Partners still waiting will be declined." />
            ) : r.status === 'closed' || partnerWithdrew ? (
              <ActionButton endpoint={`/api/sparring/${r.id}`} body={{ action: 'reopen' }} label="Reopen request" />
            ) : undefined
          ) : r.boxer ? (
            <MessageButton target={{ kind: 'boxer', boxerId: r.boxer.id }} label="Message the coach" variant="primary" />
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6">
        {partnerWithdrew ? <Alert tone="warning" title="The approved partner’s club withdrew">Reopen the request to find another partner.</Alert> : null}
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <BoxerSummary boxer={r.boxer} clubName={r.club.name} label="Looking for a partner" />
          <Card title="Request details">
            <dl className="grid grid-cols-[minmax(0,9rem)_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted">When</dt>
              <dd className="text-ink">{r.availabilityNote ?? <span className="text-muted">Not specified</span>}</dd>
              <dt className="text-muted">Where</dt>
              <dd className="text-ink">{r.location ?? <span className="text-muted">Not specified</span>}</dd>
              <dt className="text-muted">Notes</dt>
              <dd className="whitespace-pre-wrap text-ink">{r.notes ?? <span className="text-muted">None</span>}</dd>
              <dt className="text-muted">Requested</dt>
              <dd className="text-ink">{formatDate(r.createdAt)}</dd>
            </dl>
          </Card>
        </div>

        {!r.mine && r.status === 'open' ? (
          <Card title="Propose one of your boxers" description="Your boxers who could suit, most suitable first. The other club reviews and approves or declines.">
            {d.suggestions.length === 0 ? (
              <p className="text-sm text-muted">None of your active boxers is a suitable partner (same sex category, same side of 18, within 5 kg, and available), or you have already proposed them.</p>
            ) : (
              <OfferPartnerForm requestId={r.id} suggestions={d.suggestions.map((s) => ({ id: s.boxer.id, displayName: s.boxer.displayName, detail: `${s.boxer.ageYears} yrs · ${formatKg(s.boxer.weightKg)} · ${s.reasons[0]}` }))} />
            )}
          </Card>
        ) : null}

        <Card title={r.mine ? 'Partners proposed' : 'Your proposed partner'} description={r.mine ? 'Review each boxer’s suitability. Approving one arranges the session and declines the others.' : undefined}>
          {d.offers.length === 0 ? (
            <p className="text-sm text-muted">{r.mine ? 'No club has proposed a partner yet.' : 'You have not proposed a partner for this request.'}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {d.offers.map((o) => (
                <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line p-3 text-sm">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                      {o.partner?.displayName ?? 'Boxer no longer listed'}
                      {o.partner?.isJunior ? <Badge tone="neutral">Junior</Badge> : null}
                      <Badge tone={OFFER[o.status][1]}>{OFFER[o.status][0]}</Badge>
                    </p>
                    <p className="text-muted">
                      {o.byMe ? 'Your boxer' : o.offeringClub.name}
                      {o.partner ? ` · ${o.partner.ageYears} yrs · ${formatKg(o.partner.weightKg)} · ${o.partner.competitiveWins}–${o.partner.competitiveLosses}–${o.partner.competitiveDraws} · ${o.partner.skillsBouts} skills` : ''}
                    </p>
                    {o.note ? <p className="mt-1 whitespace-pre-wrap text-ink">{o.note}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.mine && o.status === 'pending' ? (
                      <>
                        <ActionButton endpoint={`/api/sparring/offers/${o.id}`} body={{ action: 'approve' }} label="Approve" variant="primary" compact />
                        <ActionButton endpoint={`/api/sparring/offers/${o.id}`} body={{ action: 'decline' }} label="Decline" compact />
                      </>
                    ) : null}
                    {r.mine && o.partner ? <MessageButton target={{ kind: 'boxer', boxerId: o.partner.id }} label="Message" compact /> : null}
                    {o.byMe && (o.status === 'pending' || o.status === 'approved') ? <ActionButton endpoint={`/api/sparring/offers/${o.id}`} body={{ action: 'withdraw' }} label="Withdraw" confirm="Withdraw this boxer?" compact /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {myApproved ? (
          <Card title="Attendance" description="Your club’s private record. The other club cannot see it.">
            <AttendanceForm offerId={myApproved.id} today={ukToday()} />
            {d.attendance.length ? (
              <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
                {d.attendance.map((a) => (
                  <li key={a.sessionDate} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-28 text-ink">{formatDate(a.sessionDate)}</span>
                    <Badge tone={a.attended ? 'success' : 'danger'}>{a.attended ? 'Attended' : 'Did not attend'}</Badge>
                    {a.note ? <span className="text-muted">{a.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
