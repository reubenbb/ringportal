import Link from 'next/link';
import { formatShowTime } from '@/lib/shows';

export type GridShow = { id: string; name: string; startsAt: string; href?: string; muted?: boolean };

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const londonDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(iso));

/** "YYYY-MM" for the current UK month. */
export function currentMonth(): string {
  return londonDate(new Date().toISOString()).slice(0, 7);
}

/** Valid "YYYY-MM" no earlier than the current month (only upcoming shows are listed), else the current month. */
export function parseMonth(value: string | undefined): string {
  const now = currentMonth();
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return now;
  return value < now ? now : value;
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** Accessible month calendar: a table of weeks, shows listed in their UK-date cell. */
export function MonthGrid({ month, shows, monthHref }: { month: string; shows: GridShow[]; monthHref: (m: string) => string }) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const byDay = new Map<number, GridShow[]>();
  for (const s of shows) {
    const d = londonDate(s.startsAt);
    if (d.slice(0, 7) !== month) continue;
    const day = Number(d.slice(8, 10));
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const title = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const today = londonDate(new Date().toISOString());
  const prev = shiftMonth(month, -1);
  const canPrev = prev >= currentMonth();

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        {canPrev ? <Link href={monthHref(prev)} className="text-sm font-semibold">← <span className="sr-only">Previous month</span></Link> : <span />}
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <Link href={monthHref(shiftMonth(month, 1))} className="text-sm font-semibold"><span className="sr-only">Next month</span> →</Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
          <caption className="sr-only">Shows in {title}</caption>
          <thead>
            <tr>{WEEKDAYS.map((d) => <th key={d} scope="col" className="border-b border-line py-2 text-xs font-semibold text-muted">{d}</th>)}</tr>
          </thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={i}>
                {w.map((day, j) => {
                  const iso = day ? `${month}-${String(day).padStart(2, '0')}` : '';
                  const list = day ? (byDay.get(day) ?? []) : [];
                  return (
                    <td key={j} className={`h-24 border border-line p-1.5 align-top ${day ? '' : 'bg-surface-2/40'}`}>
                      {day ? (
                        <>
                          <span className={`inline-block min-w-6 rounded-full px-1 text-center text-xs font-semibold ${iso === today ? 'bg-electric text-white' : 'text-muted'}`}>
                            {day}
                            {list.length ? <span className="sr-only">, {list.length} {list.length === 1 ? 'show' : 'shows'}</span> : null}
                          </span>
                          <ul className="mt-1 flex flex-col gap-1">
                            {list.map((s) => (
                              <li key={s.id} className={`truncate rounded-sm px-1 py-0.5 text-xs ${s.muted ? 'bg-surface-2 text-muted line-through' : 'bg-nav-active text-link'}`}>
                                {s.href ? <Link href={s.href} className="no-underline" title={s.name}>{formatShowTime(s.startsAt)} {s.name}</Link> : <span title={s.name}>{formatShowTime(s.startsAt)} {s.name}</span>}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
