'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

export function ArchiveButton({ boxerId, archived }: { boxerId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setPending(true);
    const res = await api('POST', `/api/boxers/${boxerId}/archive`, { archived: !archived });
    setPending(false);
    if (!res.ok) return setError(res.error.message);
    router.refresh();
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant={archived ? 'secondary' : 'danger'} pending={pending} onClick={toggle}>
        {archived ? 'Restore to roster' : 'Archive boxer'}
      </Button>
      <p className="text-xs text-muted">{archived ? 'Restoring makes the boxer visible to other clubs again.' : 'Archived boxers are hidden from other clubs. Their history is kept.'}</p>
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
