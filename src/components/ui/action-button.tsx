'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { Button } from './button';

/** One-click POST to our API, then refresh (or go somewhere). Optional confirmation step for destructive actions. */
export function ActionButton({ endpoint, body, label, variant = 'secondary', confirm, redirectTo, compact }: { endpoint: string; body: unknown; label: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; confirm?: string; redirectTo?: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const size = compact ? 'min-h-9 px-3 py-1.5 text-xs' : '';

  async function run() {
    setPending(true);
    setError(null);
    const res = await api('POST', endpoint, body);
    setPending(false);
    setAsking(false);
    if (!res.ok) return setError(res.error.message);
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col gap-1">
      {asking ? (
        <span className="inline-flex flex-wrap items-center gap-2 text-sm text-ink">
          {confirm}
          <Button variant={variant} pending={pending} className={size} onClick={() => void run()}>
            Yes, {label.toLowerCase()}
          </Button>
          <Button variant="ghost" className={size} onClick={() => setAsking(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button variant={variant} pending={pending} className={size} onClick={() => (confirm ? setAsking(true) : void run())}>
          {label}
        </Button>
      )}
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
