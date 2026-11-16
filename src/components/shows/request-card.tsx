import Link from 'next/link';
import { MessageButton } from '@/components/messaging/conversation-buttons';
import { ActionButton } from '@/components/ui/action-button';
import { Badge } from '@/components/ui/card';
import { SEX_LABEL, formatKg } from '@/lib/boxers';
import { BOUT_TYPE_LABEL, formatProposalDate } from '@/lib/proposals';
import type { RequestView } from '@/server/shows/service';

/** One opponent request. `fits` lists the viewer's own boxers that meet the stated criteria (advisory). */
export function RequestCard({ r, fits = [] }: { r: RequestView; fits?: string[] }) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold text-ink">
          {SEX_LABEL[r.sex]} · {r.minAge === r.maxAge ? `${r.minAge} yrs` : `${r.minAge}–${r.maxAge} yrs`} · {formatKg(r.weightKg)}
        </span>
        <Badge tone="blue">{BOUT_TYPE_LABEL[r.boutType]}</Badge>
        {r.status === 'closed' ? <Badge tone="neutral">Closed</Badge> : null}
        {r.club.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
      </div>
      <p className="text-muted">
        {r.mine ? 'Your request' : <Link href={`/clubs/ringportal/${r.club.slug}`}>{r.club.name}</Link>}
        {r.showName && r.showId ? <> · for <Link href={`/shows/${r.showId}`}>{r.showName}</Link></> : null}
        {r.neededOn ? <> · {formatProposalDate(r.neededOn)}</> : null}
        {r.location ? <> · {r.location}</> : null}
      </p>
      {r.experience ? <p className="text-ink"><span className="text-muted">Experience wanted:</span> {r.experience}</p> : null}
      {r.boxer ? <p className="text-ink"><span className="text-muted">For their boxer:</span> {r.boxer.displayName} ({r.boxer.competitiveWins}–{r.boxer.competitiveLosses}–{r.boxer.competitiveDraws}, {r.boxer.skillsBouts} skills)</p> : null}
      {r.requirements ? <p className="whitespace-pre-wrap text-ink">{r.requirements}</p> : null}
      {fits.length ? <p className="text-ink"><Badge tone="success">Your boxers who fit</Badge> {fits.join(', ')}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {r.mine ? (
          <>
            <Link href={`/shows/requests/new?edit=${r.id}`} className="text-sm font-semibold">Edit</Link>
            {r.boxer ? <Link href={`/matchmaking?boxer=${r.boxer.id}`} className="text-sm font-semibold">See suggested opponents →</Link> : null}
            <ActionButton endpoint={`/api/opponent-requests/${r.id}`} body={{ status: r.status === 'open' ? 'closed' : 'open' }} label={r.status === 'open' ? 'Close request' : 'Reopen'} compact />
          </>
        ) : (
          <>
            {r.boxer ? (
              <Link href={`/proposals/new?boxer=${r.boxer.id}`} className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-on-primary no-underline hover:bg-primary-hover">Propose bout</Link>
            ) : null}
            <MessageButton target={{ kind: 'general', clubId: r.clubId }} label="Message club" compact />
          </>
        )}
      </div>
    </li>
  );
}
