import type { Metadata } from 'next';
import Link from 'next/link';
import { NotApprovedNotice } from '@/components/boxers/not-approved';
import { MessageButton } from '@/components/messaging/conversation-buttons';
import { Alert } from '@/components/ui/alert';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { buttonClass } from '@/components/ui/button';
import { AVAILABILITY_LABEL, AVAILABILITY_TONE, SEX_LABEL, formatKg, recordLabel, weightAgeDays, weightIsStale } from '@/lib/boxers';
import { DEFAULTS, LIMITS, SORTS, SORT_LABEL } from '@/lib/matchmaking';
import { EB_CATEGORY_LABEL } from '@/lib/eb-rules';
import { requireApprovedClubPage } from '@/server/auth/guards';
import { listRegions, parseMatchQuery, searchMatches, type MatchResult } from '@/server/matchmaking/service';
import { ownBoxersForProposal } from '@/server/proposals/service';

export const metadata: Metadata = { title: 'Matchmaking' };

function Why({ r }: { r: MatchResult }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
      {r.factors.map((f) => (
        <li key={f.key}>
          {f.label}: <span className="text-ink">{f.detail}</span> <span className="tabular-nums">({f.points}/{f.max})</span>
        </li>
      ))}
    </ul>
  );
}

function Flags({ r }: { r: MatchResult }) {
  if (!r.flags.length && !r.blocked.length) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1.5">
      {r.blocked.map((b) => (
        <li key={b}><Badge tone="danger">{b}</Badge></li>
      ))}
      {r.flags.map((f) => (
        <li key={f}><Badge tone="warning">Check: {f}</Badge></li>
      ))}
    </ul>
  );
}

function Actions({ r }: { r: MatchResult }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {r.blocked.length ? null : (
        <Link href={`/proposals/new?boxer=${r.id}`} className="inline-flex min-h-9 items-center rounded-md bg-primary px-3 text-xs font-semibold text-on-primary no-underline hover:bg-primary-hover">
          Propose bout<span className="sr-only"> with {r.displayName}</span>
        </Link>
      )}
      <MessageButton target={{ kind: 'boxer', boxerId: r.id }} label="Message" compact />
    </div>
  );
}

function Name({ r }: { r: MatchResult }) {
  return (
    <>
      <span className="font-semibold text-ink">{r.displayName}</span> {r.isJunior ? <Badge tone="neutral">Junior</Badge> : null}
      <span className="block text-xs text-muted">
        <Link href={`/clubs/ringportal/${r.clubSlug}`}>{r.clubName}</Link> · {r.clubRegion ?? 'Region not recorded'}
      </span>
    </>
  );
}

export default async function MatchmakingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { session, approved } = await requireApprovedClubPage();
  if (!approved) return <NotApprovedNotice feature="Matchmaking" />;
  const raw = await searchParams;
  const q = parseMatchQuery(raw);
  const [own, regions] = await Promise.all([ownBoxersForProposal(session), listRegions(session)]);
  const selectedId = q.boxer && own.some((b) => b.id === q.boxer) ? q.boxer : undefined;
  const search = selectedId ? await searchMatches(session, selectedId, q) : null;
  const view = q.view ?? 'table';
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v) p.set(k, v);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/matchmaking?${p}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Matchmaking"
        title="Find an opponent"
        description="Choose one of your boxers to see suitable opponents from other verified clubs, best matches first, with the reasons for each suggestion."
      />
      {own.length === 0 ? (
        <Alert tone="info" title="Add a boxer first">
          Matchmaking starts from one of your own boxers. <Link href="/boxers/new">Add a boxer</Link>.
        </Alert>
      ) : (
        <Card>
          <form method="get" action="/matchmaking" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label htmlFor="mm-boxer" className="text-sm font-semibold text-ink">Your boxer</label>
              <select id="mm-boxer" name="boxer" required defaultValue={selectedId ?? ''} className="rp-input">
                <option value="" disabled>Choose a boxer</option>
                {own.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.displayName} · {b.ageYears} yrs · {formatKg(b.weightKg)} · {recordLabel(b.competitiveWins, b.competitiveLosses, b.competitiveDraws)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mm-tol" className="text-sm font-semibold text-ink">Weight tolerance (± kg)</label>
              <input id="mm-tol" name="tol" type="number" inputMode="decimal" step={0.5} min={LIMITS.toleranceKg[0]} max={LIMITS.toleranceKg[1]} defaultValue={search?.filters.toleranceKg ?? q.tol ?? DEFAULTS.toleranceKg} className="rp-input" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mm-age" className="text-sm font-semibold text-ink">Max age gap (years)</label>
              <input id="mm-age" name="ageGap" type="number" inputMode="numeric" step={1} min={LIMITS.ageGap[0]} max={LIMITS.ageGap[1]} defaultValue={search?.filters.ageGap ?? q.ageGap ?? ''} placeholder={`Default: ${DEFAULTS.juniorAgeGap} under 18, ${DEFAULTS.adultAgeGap} adult`} className="rp-input" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mm-bouts" className="text-sm font-semibold text-ink">Max gap in competitive bouts</label>
              <input id="mm-bouts" name="boutGap" type="number" inputMode="numeric" step={1} min={0} max={200} defaultValue={q.boutGap ?? ''} placeholder="Any" className="rp-input" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mm-region" className="text-sm font-semibold text-ink">Region</label>
              <select id="mm-region" name="region" defaultValue={q.region ?? ''} className="rp-input">
                <option value="">Any</option>
                {regions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mm-sort" className="text-sm font-semibold text-ink">Sort by</label>
              <select id="mm-sort" name="sort" defaultValue={q.sort ?? 'best'} className="rp-input">
                {SORTS.map((s) => (
                  <option key={s} value={s}>{SORT_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <label className="flex min-h-11 items-center gap-2 self-end text-sm text-ink">
              <input type="checkbox" name="unavailable" value="1" defaultChecked={q.unavailable === '1'} />
              Also show boxers who are not available
            </label>
            {q.view ? <input type="hidden" name="view" value={q.view} /> : null}
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
              <button type="submit" className={buttonClass('primary')}>Search</button>
              {selectedId ? <Link href={`/matchmaking?boxer=${selectedId}`} className="text-sm font-semibold">Clear filters</Link> : null}
            </div>
          </form>
        </Card>
      )}

      {search ? (
        <>
          {weightIsStale(search.ownWeightRecordedAt) ? (
            <div className="mt-6">
              <Alert tone="warning" title={`${search.own.displayName}’s weight was last updated ${weightAgeDays(search.ownWeightRecordedAt)} days ago`}>
                Results are based on {formatKg(search.own.weightKg)}. <Link href={`/boxers/${search.own.id}`}>Update the weight</Link> if it has changed, so other clubs get an accurate match.
              </Alert>
            </div>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted" role="status">
              <strong className="text-ink">{search.suitable.length}</strong> suitable {search.suitable.length === 1 ? 'opponent' : 'opponents'} for {search.own.displayName}{search.ownCategory ? ` (${EB_CATEGORY_LABEL[search.ownCategory]})` : ''}: {SEX_LABEL[search.own.sex].toLowerCase()}, {formatKg(search.own.weightKg - search.filters.toleranceKg)}–{formatKg(search.own.weightKg + search.filters.toleranceKg)}, aged {search.filters.minAge}–{search.filters.maxAge}{search.filters.region ? `, ${search.filters.region} region` : ''}.
            </p>
            <nav aria-label="Result view" className="flex gap-1">
              {(['table', 'cards'] as const).map((v) => (
                <Link key={v} href={keep({ view: v })} aria-current={view === v ? 'page' : undefined} className={`rounded-md px-3 py-2 text-sm font-semibold ${view === v ? 'bg-nav-active text-link' : 'text-muted hover:bg-surface-2 hover:text-ink'}`}>
                  {v === 'table' ? 'Table' : 'Cards'}
                </Link>
              ))}
            </nav>
          </div>

          {search.suitable.length === 0 ? (
            <Card className="mt-3">
              <div className="py-8 text-center text-sm text-muted">
                <p className="font-semibold text-ink">No suitable opponents found</p>
                <p className="mt-1">Try a wider weight tolerance or age gap, another region, or <Link href={`/matchmaking?boxer=${selectedId}`}>clear the filters</Link>. More boxers appear as clubs join RingPortal.</p>
              </div>
            </Card>
          ) : view === 'cards' ? (
            <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {search.suitable.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div><Name r={r} /></div>
                    <span className="rp-display text-2xl tabular-nums text-ink" title="Suitability score out of 100">{r.score}</span>
                  </div>
                  <p className="text-sm text-ink">
                    {r.ageYears} yrs{r.category ? ` (${EB_CATEGORY_LABEL[r.category]})` : ''} · {formatKg(r.weightKg)} · {recordLabel(r.competitiveWins, r.competitiveLosses, r.competitiveDraws)} · {r.skillsBouts} skills
                  </p>
                  <Badge tone={AVAILABILITY_TONE[r.availability]}>{AVAILABILITY_LABEL[r.availability]}</Badge>
                  <Why r={r} />
                  <Flags r={r} />
                  <div className="mt-auto"><Actions r={r} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <Card className="mt-3">
              <div className="relative -mx-5 -my-4 overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <caption className="sr-only">Suitable opponents, {SORT_LABEL[search.filters.sort].toLowerCase()} first</caption>
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th scope="col" className="px-5 py-2 font-semibold">Score</th>
                      <th scope="col" className="px-2 py-2 font-semibold">Boxer</th>
                      <th scope="col" className="px-2 py-2 font-semibold">Age</th>
                      <th scope="col" className="px-2 py-2 text-right font-semibold">Weight</th>
                      <th scope="col" className="px-2 py-2 text-right font-semibold">Record (W–L–D)</th>
                      <th scope="col" className="px-2 py-2 text-right font-semibold">Skills</th>
                      <th scope="col" className="px-2 py-2 font-semibold">Why suggested</th>
                      <th scope="col" className="px-5 py-2 font-semibold"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {search.suitable.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="px-5 py-3 text-lg font-bold tabular-nums text-ink">{r.score}</td>
                        <td className="px-2 py-3"><Name r={r} /></td>
                        <td className="px-2 py-3 tabular-nums text-ink">{r.ageYears}{r.category ? <span className="block text-xs text-muted">{EB_CATEGORY_LABEL[r.category]}</span> : null}</td>
                        <td className="px-2 py-3 text-right tabular-nums text-ink">{formatKg(r.weightKg)}</td>
                        <td className="px-2 py-3 text-right tabular-nums text-ink">{recordLabel(r.competitiveWins, r.competitiveLosses, r.competitiveDraws)}</td>
                        <td className="px-2 py-3 text-right tabular-nums text-ink">{r.skillsBouts}</td>
                        <td className="max-w-xs px-2 py-3"><Why r={r} /><Flags r={r} /></td>
                        <td className="px-5 py-3"><Actions r={r} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {search.blocked.length ? (
            <Card title="Not suggested" description="These boxers fail a check, shown under each name, so they are not suitable matches right now." className="mt-6">
              <ul className="divide-y divide-line">
                {search.blocked.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                    <div>
                      <Name r={r} />
                      <Flags r={r} />
                    </div>
                    <Actions r={r} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <p className="mt-4 max-w-3xl text-xs text-muted">
            Scores are out of 100: weight closeness (40), age closeness (25), competitive experience (25) and skills bouts (10). Under-18s are only matched with under-18s. Pairings are checked against the England Boxing Rule Book 26.3: age categories and age gaps (2026 Club Boxing Matrix), the 2 kg limit for Minors and Schools, and the weight-category spans for Junior, Youth and Senior (Section 13). A suggestion is not England Boxing approval: coaches still check medicals, the weigh-in and every other rule. Skills bouts are never counted in a competitive record.
          </p>
        </>
      ) : null}
    </>
  );
}
