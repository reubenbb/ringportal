'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { Icon } from './icons';

export function SignOutButton({ endpoint, redirectTo, compact = false }: { endpoint: string; redirectTo: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    setPending(true);
    setFailed(false);
    const res = await api('POST', endpoint);
    if (!res.ok) {
      setPending(false);
      setFailed(true);
      return;
    }
    router.replace(redirectTo);
    router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      {failed ? (
        <span role="alert" className="text-xs text-danger">
          Sign-out failed. Try again.
        </span>
      ) : null}
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        className="inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-60"
      >
        <Icon name="signout" />
        <span className={compact ? 'sr-only sm:not-sr-only' : ''}>{pending ? 'Signing out…' : 'Sign out'}</span>
      </button>
    </span>
  );
}
