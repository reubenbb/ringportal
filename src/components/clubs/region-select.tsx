'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';

/** Admin: set a club's region. Saves on change. */
export function RegionSelect({ clubId, value, regions }: { clubId: string; value: string | null; regions: string[] }) {
  const router = useRouter();
  const [current, setCurrent] = useState(value ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  async function change(next: string) {
    const prev = current;
    setCurrent(next);
    setState('saving');
    const res = await api('POST', `/api/admin/clubs/${clubId}/region`, { region: next });
    if (!res.ok) {
      setCurrent(prev);
      return setState(res.error.fields?.region ?? res.error.message);
    }
    setState('saved');
    router.refresh();
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <label htmlFor="club-region" className="sr-only">Region</label>
      <select id="club-region" value={current} disabled={state === 'saving'} onChange={(e) => void change(e.target.value)} className="rp-input min-h-9 w-64 py-1.5 text-sm">
        <option value="">Not recorded</option>
        {regions.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <span role="status" className={`text-xs ${state === 'saved' || state === 'idle' || state === 'saving' ? 'text-muted' : 'text-danger'}`}>{state === 'saved' ? 'Saved' : state === 'idle' || state === 'saving' ? '' : state}</span>
    </span>
  );
}
