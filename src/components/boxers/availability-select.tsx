'use client';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { api } from '@/lib/api-client';
import { AVAILABILITY, AVAILABILITY_LABEL, type Availability } from '@/lib/boxers';

/** One-step availability change; records who changed it and when on the server. */
export function AvailabilitySelect({ boxerId, value, name }: { boxerId: string; value: Availability; name: string }) {
  const router = useRouter();
  const id = useId();
  const [current, setCurrent] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: Availability) {
    const prev = current;
    setCurrent(next);
    setPending(true);
    setError(null);
    const res = await api('POST', `/api/boxers/${boxerId}/availability`, { status: next });
    setPending(false);
    if (!res.ok) {
      setCurrent(prev);
      setError(res.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="sr-only">
        Availability for {name}
      </label>
      <select id={id} value={current} disabled={pending} onChange={(e) => void change(e.target.value as Availability)} className="rp-input min-h-9 w-52 py-1.5 text-sm" aria-busy={pending || undefined}>
        {AVAILABILITY.map((a) => (
          <option key={a} value={a}>
            {AVAILABILITY_LABEL[a]}
          </option>
        ))}
      </select>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
