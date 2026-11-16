'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/club-status';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';

type SessionRow = { id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; current: boolean };

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SessionsList() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ sessions: SessionRow[] }>('GET', '/api/account/sessions');
    if (res.ok) {
      setRows(res.data.sessions);
      setError(null);
    } else setError(res.error.message);
  }, []);

  useEffect(() => {
    // Initial fetch from the API on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function revoke(id: string) {
    setBusy(id);
    const res = await api('DELETE', `/api/account/sessions/${id}`);
    setBusy(null);
    if (!res.ok) setError(res.error.message);
    await load();
  }

  if (error && !rows) return <Alert tone="danger" live>{error} <button type="button" className="font-semibold underline" onClick={() => void load()}>Retry</button></Alert>;
  if (!rows) return <p className="text-sm text-muted" aria-live="polite">Loading signed-in devices…</p>;
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="danger" live>{error}</Alert> : null}
      <ul className="divide-y divide-line rounded-md border border-line">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                {describeAgent(s.userAgent)} {s.current ? <Badge tone="blue">This device</Badge> : null}
              </p>
              <p className="text-xs text-muted">
                Signed in {formatDateTime(s.createdAt)} · Last active {formatDateTime(s.lastSeenAt)}
              </p>
            </div>
            {!s.current ? (
              <Button variant="secondary" className="min-h-9 py-1.5" pending={busy === s.id} onClick={() => void revoke(s.id)}>
                Sign out
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
