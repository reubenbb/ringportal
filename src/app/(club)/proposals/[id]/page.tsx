import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { Thread } from '@/components/messaging/thread';
import { BoxerSummary, matchNotes } from '@/components/proposals/boxer-summary';
import { ProposalActions, TermsList } from '@/components/proposals/proposal-actions';
import { Alert } from '@/components/ui/alert';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { formatKg } from '@/lib/boxers';
import { formatMessageTime } from '@/lib/messaging';
import { BOUT_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, TERM_LABEL, formatProposalDate, type Terms } from '@/lib/proposals';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { getProposalThread } from '@/server/messaging/service';
import { getProposal, type ProposalDetail } from '@/server/proposals/service';

export const metadata: Metadata = { title: 'Bout proposal' };

function termValue(k: keyof Terms, t: Terms): string {
  switch (k) {
    case 'proposedDate':
      return formatProposalDate(t.proposedDate);
    case 'weightKg':
      return formatKg(t.weightKg);
    case 'boutType':
      return BOUT_TYPE_LABEL[t.boutType];
    default:
      return t[k] ?? 'None';
  }
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Proposal sent',
  revised: 'Proposed changes',
  accepted: 'Accepted in principle',
  confirmed: 'Gave final confirmation',
  bout_confirmed: 'Bout confirmed by both clubs',
  declined: 'Declined',
  withdrawn: 'Withdrew',
};

function nextStep(p: ProposalDetail): { tone: 'info' | 'success' | 'warning' | 'danger'; title: string; body: string } {
  const me = p.viewerClubId;
  const other = me === p.proposingClub.id ? p.receivingClub : p.proposingClub;
  const mine = p.waitingOn.includes(me);
  const v = `version ${p.currentVersion}`;
  const lastEvent = p.events[p.events.length - 1];
  const by = lastEvent ? (lastEvent.clubId === me ? 'your club' : other.name) : other.name;
  const when = lastEvent ? formatMessageTime(lastEvent.occurredAt) : '';
  switch (p.status) {
    case 'sent':
    case 'negotiating':
      return mine
        ? { tone: 'warning', title: 'Your club needs to respond', body: `${other.name} sent ${v}. Accept it in principle, propose changes or decline.` }
        : { tone: 'info', title: `Waiting for ${other.name}`, body: `${other.name} needs to respond to ${v}.` };
    case 'accepted_in_principle':
    case 'awaiting_confirmation':
      return mine
        ? { tone: 'warning', title: 'Your final confirmation is needed', body: `${v[0]!.toUpperCase()}${v.slice(1)} has been accepted in principle. It becomes a confirmed bout only when both clubs confirm this version.` }
        : { tone: 'info', title: `Waiting for ${other.name} to confirm`, body: `Your club has confirmed ${v}. The bout is confirmed when ${other.name} confirms the same version.` };
    case 'confirmed':
      return { tone: 'success', title: 'Confirmed bout', body: `Both clubs gave final confirmation of ${v}. Both boxers are now marked Confirmed.` };
    case 'declined':
      return { tone: 'danger', title: 'Declined', body: `Declined by ${by}${when ? ` (${when})` : ''}.` };
    case 'withdrawn':
      return { tone: 'danger', title: 'Withdrawn', body: `Withdrawn by ${by}${when ? ` (${when})` : ''}.` };
  }
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Bout proposals" />;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const p = await getProposal(session, id.data);
  if (!p) notFound();
  const thread = await getProposalThread(session, p.id);
  const justSent = (await searchParams).sent === '1';

  const me = session.clubId;
  const other = me === p.proposingClub.id ? p.receivingClub : p.proposingClub;
  const clubLabel = (clubId: string) => (clubId === me ? 'Your club' : clubId === p.proposingClub.id ? p.proposingClub.name : p.receivingClub.name);
  const step = nextStep(p);
  const confirmationOpen = ['accepted_in_principle', 'awaiting_confirmation', 'confirmed'].includes(p.status);
  const notes = matchNotes(p.proposingBoxer, p.receivingBoxer, p.current.weightKg);
  const title = `${p.proposingBoxer?.displayName ?? 'Boxer'} v ${p.receivingBoxer?.displayName ?? 'Boxer'}`;

  return (
    <>
      <Link href="/proposals" className="mb-4 inline-block text-sm font-semibold">
        ← Bout proposals
      </Link>
      <PageHeader
        eyebrow="Bout proposal"
        title={title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
            <span>Version {p.currentVersion}</span>
            <span aria-hidden="true">·</span>
            <span>
              {p.proposingClub.id === me ? 'Your club' : p.proposingClub.name} proposed to {p.receivingClub.id === me ? 'your club' : p.receivingClub.name}
            </span>
            {other.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
          </span>
        }
      />

      <div className="flex flex-col gap-6">
        {justSent ? (
          <Alert tone="success" title="Proposal sent" live>
            {other.name} can now see it under Bout proposals.
          </Alert>
        ) : null}
        <Alert tone={step.tone} title={step.title}>
          {step.body}
        </Alert>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-6">
            <Card title="Current terms" description={`Version ${p.currentVersion}, proposed by ${clubLabel(p.current.authorClubId).replace('Your club', 'your club')} · ${formatMessageTime(p.current.createdAt)}`}>
              <TermsList terms={p.current} />
              {notes.length ? (
                <div className="mt-4">
                  <Alert tone="warning" title="Points to check">
                    <ul className="list-disc pl-4">
                      {notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                    <p className="mt-1">RingPortal does not decide eligibility. Check the bout against your governing body’s rules.</p>
                  </Alert>
                </div>
              ) : null}
              {p.actions.length ? (
                <div className="mt-5 border-t border-line pt-4">
                  <ProposalActions proposalId={p.id} version={p.currentVersion} status={p.status} actions={p.actions} current={p.current} otherClubName={other.name} />
                </div>
              ) : null}
            </Card>

            <Card title="Final confirmation" description="Both clubs must confirm the same version. Any change to the terms resets both.">
              <ul className="flex flex-col gap-2">
                {[p.proposingClub, p.receivingClub].map((c) => {
                  const conf = p.confirmations.find((x) => x.clubId === c.id);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2.5 text-sm">
                      <span className="font-semibold text-ink">{c.id === me ? `${c.name} (your club)` : c.name}</span>
                      {conf ? (
                        <Badge tone="success">✓ Confirmed v{p.currentVersion} · {formatMessageTime(conf.confirmedAt)}</Badge>
                      ) : confirmationOpen ? (
                        <Badge tone="warning">Not yet confirmed</Badge>
                      ) : (
                        <Badge tone="neutral">Opens after acceptance in principle</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card title="Version history" description="Every version of the terms is kept. Acceptance and confirmation always refer to one version.">
              <ol className="flex flex-col gap-3">
                {[...p.versions].reverse().map((v) => {
                  const prev = p.versions.find((x) => x.version === v.version - 1);
                  return (
                    <li key={v.version} className="rounded-md border border-line p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">Version {v.version}</span>
                        {v.version === p.currentVersion ? <Badge tone="blue">Current</Badge> : null}
                        <span className="text-muted">
                          by {clubLabel(v.authorClubId)} · {formatMessageTime(v.createdAt)}
                        </span>
                      </div>
                      {prev ? (
                        <ul className="mt-2 flex flex-col gap-1">
                          {v.changed.map((k) => (
                            <li key={k}>
                              <span className="text-muted">{TERM_LABEL[k]}:</span> <s className="text-muted">{termValue(k, prev)}</s> → <span className="font-semibold text-ink">{termValue(k, v)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-muted">
                          Original proposal: {formatProposalDate(v.proposedDate)}, {formatKg(v.weightKg)}, {BOUT_TYPE_LABEL[v.boutType].toLowerCase()}.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>

            <Card title="Activity">
              <ol className="flex flex-col gap-2 text-sm">
                {[...p.events].reverse().map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-2">
                    <time dateTime={e.occurredAt} className="w-28 shrink-0 text-muted">
                      {formatMessageTime(e.occurredAt)}
                    </time>
                    <span className="text-ink">
                      <strong>{clubLabel(e.clubId)}</strong> · {EVENT_LABEL[e.event] ?? e.event}
                      {e.event !== 'bout_confirmed' ? <span className="text-muted"> (v{e.version})</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          <aside className="flex flex-col gap-4">
            <BoxerSummary boxer={p.proposingBoxer} clubName={p.proposingClub.name} label={p.proposingClub.id === me ? 'Your boxer' : 'Their boxer'} />
            <BoxerSummary boxer={p.receivingBoxer} clubName={p.receivingClub.name} label={p.receivingClub.id === me ? 'Your boxer' : 'Their boxer'} />
          </aside>
        </div>

        {thread ? (
          <Card
            title={`Messages with ${other.name}`}
            description="Linked to this proposal. The agreed terms are always shown above, not only in the messages."
            actions={
              <Link href={`/messages/${thread.conversation.id}`} className="text-sm font-semibold">
                Open full conversation →
              </Link>
            }
          >
            <Thread
              conversationId={thread.conversation.id}
              initialMessages={thread.messages}
              hasEarlier={thread.hasEarlier}
              lastReadMessageId={thread.lastReadMessageId}
              otherClubName={other.name}
              canSend={other.approved}
              compact
            />
          </Card>
        ) : null}
      </div>
    </>
  );
}
