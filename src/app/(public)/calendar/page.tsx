import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLockup } from '@/components/brand/logo';
import { buttonClass } from '@/components/ui/button';
import { formatShowDate, formatShowTime } from '@/lib/shows';
import { MonthGrid, parseMonth } from '@/components/shows/month-grid';
import { publicCalendar } from '@/server/shows/service';

export const metadata: Metadata = { title: 'Show calendar', description: 'Upcoming amateur boxing shows listed by verified England Boxing clubs on RingPortal.' };
export const dynamic = 'force-dynamic';

/** Public, basic calendar: no sign-in, no contact details, no boxer information. */
export default async function PublicCalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; m?: string }> }) {
  const sp = await searchParams;
  const view = sp.view === 'month' ? 'month' : 'list';
  const month = parseMonth(sp.m);
  const shows = await publicCalendar();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5">
          <Link href="/" className="text-ink" aria-label="RingPortal home"><BrandLockup className="h-5 w-auto" aria-hidden="true" /></Link>
          <Link href="/login" className={buttonClass('secondary', 'min-h-10 py-2')}>Club sign in</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">
        <p className="rp-eyebrow">Amateur boxing</p>
        <h1 className="rp-display mt-2 text-5xl text-ink">Show calendar</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">Upcoming shows listed by verified clubs. Contact the host club for tickets and details. Clubs can sign in for full show information and opponent requests.</p>
        <nav aria-label="Calendar view" className="mt-6 flex gap-1">
          {(['list', 'month'] as const).map((v) => (
            <Link key={v} href={v === 'list' ? '/calendar' : `/calendar?view=month&m=${month}`} aria-current={view === v ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm font-semibold ${view === v ? 'bg-nav-active text-link' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
              {v === 'list' ? 'List' : 'Month'}
            </Link>
          ))}
        </nav>
        {view === 'month' ? (
          <div className="mt-4"><MonthGrid month={month} shows={shows.map((s) => ({ id: s.id, name: `${s.name} (${s.hostClub})`, startsAt: s.startsAt }))} monthHref={(m) => `/calendar?view=month&m=${m}`} /></div>
        ) : shows.length === 0 ? (
          <p className="mt-10 rounded-lg border border-line bg-surface px-5 py-10 text-center text-sm text-muted">No upcoming shows are listed yet.</p>
        ) : (
          <ol className="mt-8 divide-y divide-line rounded-lg border border-line bg-surface">
            {shows.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-4">
                <div className="w-48 shrink-0 text-sm">
                  <p className="font-semibold text-ink">{formatShowDate(s.startsAt)}</p>
                  <p className="text-muted">{formatShowTime(s.startsAt)}</p>
                </div>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-semibold text-ink">{s.name}</p>
                  <p className="text-sm text-muted">Hosted by {s.hostClub}</p>
                  <p className="text-sm text-muted">{s.venue}, {s.area}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}
