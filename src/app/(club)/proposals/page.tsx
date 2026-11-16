import type { Metadata } from 'next';
import Link from 'next/link';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { formatKg } from '@/lib/boxers';
import { BOUT_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, formatProposalDate } from '@/lib/proposals';
import { formatMessageTime } from '@/lib/messaging';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { PROPOSAL_FILTERS, listProposals, type ProposalFilter } from '@/server/proposals/service';

export const metadata: Metadata = { title: 'Bout proposals' };

const TAB_LABEL: Record<ProposalFilter, string> = {
  action: 'Needs your action',
  open: 'All open',
  confirmed: 'Confirmed bouts',
  closed: 'Declined & withdrawn',
};

const EMPTY: Record<ProposalFilter, string> = {
  action: 'Nothing is waiting on your club.',
  open: 'No open proposals.',
  confirmed: 'No confirmed bouts yet.',
  closed: 'No declined or withdrawn proposals.',
};

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ tab?: string; cursor?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Bout proposals" />;
  const sp = await searchParams;
  const tab: ProposalFilter = PROPOSAL_FILTERS.includes(sp.tab as ProposalFilter) ? (sp.tab as ProposalFilter) : 'action';
  const { items, nextCursor } = await listProposals(session, tab, sp.cursor);

  return (
    <>
      <PageHeader
        eyebrow="Matchmaking"
        title="Bout proposals"
        description="Proposals between your club and other verified clubs. A bout is confirmed only when both clubs have confirmed the same version of the terms."
        actions={
          <Link href="/clubs" className="text-sm font-semibold">
            Find an opponent in the Club directory →
          </Link>
        }
      />
      <nav aria-label="Proposal filters" className="mb-4 flex flex-wrap gap-1">
        {PROPOSAL_FILTERS.map((f) => (
          <Link
            key={f}
            href={`/proposals?tab=${f}`}
            aria-current={tab === f ? 'page' : undefined}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === f ? 'bg-nav-active text-link' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}
          >
            {TAB_LABEL[f]}
          </Link>
        ))}
      </nav>
      <Card>
        {items.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted">
            <p className="font-semibold text-ink">{EMPTY[tab]}</p>
            <p className="mt-1">
              To propose a bout, open a verified club in the <Link href="/clubs">Club directory</Link> and choose <strong>Propose bout</strong> next to one of their boxers.
            </p>
          </div>
        ) : (
          <ul className="-mx-5 -my-4 divide-y divide-line">
            {items.map((p) => (
              <li key={p.id}>
                <Link href={`/proposals/${p.id}`} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-3.5 text-ink no-underline hover:bg-surface-2">
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                      {p.needsMyAction ? <Badge tone="blue">Your move</Badge> : null}
                      {p.otherClub.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
                    </div>
                    <p className="mt-1.5 font-semibold">
                      {p.myBoxer?.displayName ?? 'Boxer no longer listed'} <span className="font-normal text-muted">v</span> {p.theirBoxer?.displayName ?? 'Boxer no longer listed'}
                    </p>
                    <p className="text-sm text-muted">
                      {p.iProposed ? 'Proposed to' : 'Proposed by'} {p.otherClub.name}
                    </p>
                  </div>
                  <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-muted">Date</dt>
                    <dd>{formatProposalDate(p.terms.proposedDate)}</dd>
                    <dt className="text-muted">Weight</dt>
                    <dd className="tabular-nums">{formatKg(p.terms.weightKg)}</dd>
                    <dt className="text-muted">Type</dt>
                    <dd>{BOUT_TYPE_LABEL[p.terms.boutType]}</dd>
                  </dl>
                  <p className="text-xs text-muted">
                    v{p.currentVersion} · updated <time dateTime={p.updatedAt}>{formatMessageTime(p.updatedAt)}</time>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {nextCursor ? (
        <p className="mt-4 text-right text-sm">
          <Link href={`/proposals?${new URLSearchParams({ tab, cursor: nextCursor })}`}>Older proposals →</Link>
        </p>
      ) : null}
    </>
  );
}
