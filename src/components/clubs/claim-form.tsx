'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

type Found = { id: string; name: string; region: string | null };

/** Search the England Boxing directory for an unclaimed record and ask to claim it. */
export function ClaimForm() {
  const router = useRouter();
  const id = useId();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [searched, setSearched] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
      const res = await api<{ items: Found[] }>('GET', `/api/auth/register/directory?q=${encodeURIComponent(q)}`);
      if (mine !== seq.current) return;
      setFound(res.ok ? res.data.items : []);
      setSearched(true);
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  async function claim(d: Found) {
    setPending(d.id);
    setError(null);
    const res = await api('POST', '/api/club/claim', { directoryClubId: d.id });
    setPending(null);
    if (!res.ok) return setError(res.error.message);
    router.refresh();
  }

  const show = query.trim().length >= 3;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-ink">Find your club</label>
      <input id={id} type="search" value={query} onChange={(e) => { setQuery(e.target.value); setSearched(false); }} className="rp-input" placeholder="Start typing your club’s name" autoComplete="off" />
      <div role="status" className="text-sm text-muted">{show && searched && found.length === 0 ? 'No unclaimed club found with that name.' : ''}</div>
      {show && found.length ? (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {found.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-1.5 text-sm">
              <span className="text-ink"><strong>{d.name}</strong>{d.region ? <span className="text-muted"> · {d.region}</span> : null}</span>
              <Button variant="secondary" className="min-h-9 px-3 py-1.5 text-xs" pending={pending === d.id} onClick={() => void claim(d)}>Claim</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <p className="text-xs text-muted">An administrator checks every claim before the record is linked.</p>
    </div>
  );
}
