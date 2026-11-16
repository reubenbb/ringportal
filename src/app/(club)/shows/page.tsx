import type { Metadata } from 'next';
import Link from 'next/link';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { RequestCard } from '@/components/shows/request-card';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { fitsRequest, formatShowDate, formatShowTime } from '@/lib/shows';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { ownBoxersForProposal } from '@/server/proposals/service';
import { listRequests, listShows, type ShowView } from '@/server/shows/service';

export const metadata: Metadata = { title: 'Shows' };
const TABS = { upcoming: 'Upcoming shows', requests: 'Opponent requests', mine: 'My listings' } as const;
type Tab = keyof typeof TABS;

function ShowRow({ s }: { s: ShowView }) {
  return (
    <li>
      <Link href={`/shows/${s.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3.5 text-ink no-underline hover:bg-surface-2">
        <div className="w-44 shrink-0 text-sm">
          <p className="font-semibold">{formatShowDate(s.startsAt)}</p>
          <p className="text-muted">{formatShowTime(s.startsAt)}</p>
        </div>
        <div className="min-w-0 flex-1 basis-56">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {s.name}
            {s.status === 'cancelled' ? <Badge tone="danger">Cancelled</Badge> : null}
            {s.mine ? <Badge tone="blue">Your show</Badge> : null}
            {s.host.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
          </p>
          <p className="text-sm text-muted">{s.host.name} · {s.venue}, {s.postcode}</p>
          {s.requirements ? <p className="mt-0.5 truncate text-sm text-ink">Needs: {s.requirements}</p> : null}
        </div>
      </Link>
    </li>
  );
}

export default async function ShowsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Shows and opponent requests" />;
  const sp = await searchParams;
  const tab: Tab = sp.tab && sp.tab in TABS ? (sp.tab as Tab) : 'upcoming';
  return (
    <>
      <PageHeader
        eyebrow="Shows"
        title="Shows & opponent requests"
        description="Shows listed by verified clubs, and requests from clubs looking for an opponent."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/shows/requests/new" className={buttonClass('secondary')}>Request an opponent</Link>
            <Link href="/shows/new" className={buttonClass('primary')}>List a show</Link>
          </div>
        }
      />
      <nav aria-label="Show views" className="mb-4 flex flex-wrap gap-1">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link key={t} href={`/shows?tab=${t}`} aria-current={tab === t ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm font-semibold ${tab === t ? 'bg-nav-active text-link' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
            {TABS[t]}
          </Link>
        ))}
        <Link href="/calendar" className="ml-auto rounded-md px-3 py-2 text-sm font-semibold">Public calendar →</Link>
      </nav>
      {tab === 'upcoming' ? <Upcoming shows={await listShows(session, 'upcoming')} /> : null}
      {tab === 'requests' ? <Requests session={session} /> : null}
      {tab === 'mine' ? <Mine session={session} /> : null}
    </>
  );
}

function Upcoming({ shows }: { shows: ShowView[] }) {
  return (
    <Card>
      {shows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No upcoming shows have been listed yet.</p>
      ) : (
        <ul className="-mx-5 -my-4 divide-y divide-line">{shows.map((s) => <ShowRow key={s.id} s={s} />)}</ul>
      )}
    </Card>
  );
}

type Session = Awaited<ReturnType<typeof requireApprovedClubPage>>['session'];

async function Requests({ session }: { session: Session }) {
  const [requests, own] = await Promise.all([listRequests(session, 'open'), ownBoxersForProposal(session)]);
  return (
    <Card description="Open requests from other verified clubs. A request stays open until the club closes it.">
      {requests.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No open opponent requests from other clubs.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <RequestCard key={r.id} r={r} fits={own.filter((b) => fitsRequest(b, r)).map((b) => b.displayName)} />
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">“Your boxers who fit” compares sex, age and weight (within 2 kg) only. It is a suggestion, not an eligibility decision.</p>
    </Card>
  );
}

async function Mine({ session }: { session: Session }) {
  const [shows, requests] = await Promise.all([listShows(session, 'mine'), listRequests(session, 'mine')]);
  return (
    <div className="flex flex-col gap-6">
      <Card title="Your shows">
        {shows.length === 0 ? <p className="py-4 text-sm text-muted">You have not listed a show yet.</p> : <ul className="-mx-5 -my-4 divide-y divide-line">{shows.map((s) => <ShowRow key={s.id} s={s} />)}</ul>}
      </Card>
      <Card title="Your opponent requests">
        {requests.length === 0 ? <p className="py-4 text-sm text-muted">You have not published an opponent request yet.</p> : <ul className="flex flex-col gap-3">{requests.map((r) => <RequestCard key={r.id} r={r} />)}</ul>}
      </Card>
    </div>
  );
}
