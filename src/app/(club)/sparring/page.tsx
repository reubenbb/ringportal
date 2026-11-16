import type { Metadata } from 'next';
import Link from 'next/link';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { buttonClass } from '@/components/ui/button';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { formatKg } from '@/lib/boxers';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { listSparring, type SparringSummary } from '@/server/sparring/service';

export const metadata: Metadata = { title: 'Sparring' };
const STATUS = { open: ['Open', 'success'], arranged: ['Partner arranged', 'blue'], closed: ['Closed', 'neutral'] } as const;

function Rows({ items, empty }: { items: SparringSummary[]; empty: string }) {
  if (!items.length) return <p className="py-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="-mx-5 -my-4 divide-y divide-line">
      {items.map((r) => (
        <li key={r.id}>
          <Link href={`/sparring/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-ink no-underline hover:bg-surface-2">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {r.boxer?.displayName ?? 'Boxer no longer listed'}
                {r.boxer?.isJunior ? <Badge tone="neutral">Junior</Badge> : null}
                <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
                {r.club.isDemo ? <Badge tone="warning">Demo data</Badge> : null}
              </p>
              <p className="text-sm text-muted">
                {r.mine ? 'Your request' : r.club.name}
                {r.boxer ? ` · ${r.boxer.ageYears} yrs · ${formatKg(r.boxer.weightKg)}` : ''}
                {r.location ? ` · ${r.location}` : ''}
                {r.availabilityNote ? ` · ${r.availabilityNote}` : ''}
              </p>
            </div>
            {r.mine && r.pendingOffers ? <Badge tone="warning">{r.pendingOffers} {r.pendingOffers === 1 ? 'partner' : 'partners'} proposed</Badge> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function SparringPage() {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Sparring" />;
  const { open, mine, offered } = await listSparring(session);
  return (
    <>
      <PageHeader
        eyebrow="Sparring"
        title="Individual sparring"
        description="One boxer looking for one suitable sparring partner, arranged coach to coach. Separate from competitive bout proposals."
        actions={<Link href="/sparring/new" className={buttonClass('primary')}>Request a sparring partner</Link>}
      />
      <div className="flex flex-col gap-6">
        <Card title="Open requests from other clubs"><Rows items={open} empty="No open sparring requests from other clubs." /></Card>
        <Card title="Your requests"><Rows items={mine} empty="You have not requested a sparring partner yet." /></Card>
        {offered.length ? <Card title="Requests you have proposed a partner for"><Rows items={offered} empty="" /></Card> : null}
      </div>
    </>
  );
}
