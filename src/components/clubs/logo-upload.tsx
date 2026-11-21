'use client';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ClubLogo } from './club-logo';

const MAX_BYTES = 1024 * 1024;

export function LogoUpload({ clubId, name, version }: { clubId: string; name: string; version: string | null }) {
  const router = useRouter();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function send(method: 'POST' | 'DELETE', file?: File) {
    setError(null);
    setDone(null);
    if (file && file.size > MAX_BYTES) return setError('Use an image of 1 MB or less.');
    setPending(method === 'POST' ? 'upload' : 'remove');
    let res: Response;
    try {
      const body = file ? new FormData() : undefined;
      if (file) body!.append('logo', file);
      res = await fetch('/api/club/logo', { method, body, credentials: 'same-origin' });
    } catch {
      setPending(null);
      return setError('Could not reach RingPortal. Check your connection and try again.');
    }
    setPending(null);
    if (input.current) input.current.value = '';
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string; fields?: Record<string, string> } } | null;
      return setError(payload?.error?.fields?.logo ?? payload?.error?.message ?? 'Something went wrong. Please try again.');
    }
    setDone(method === 'POST' ? 'Logo updated.' : 'Logo removed.');
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <ClubLogo clubId={clubId} name={name} version={version} size={72} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-ink">Club logo</label>
        <input
          ref={input}
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-describedby={`${id}-hint${error ? ` ${id}-err` : ''}`}
          disabled={pending !== null}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void send('POST', f);
          }}
        />
        <p id={`${id}-hint`} className="text-xs text-muted">PNG, JPEG or WebP, up to 1 MB. It is resized to 256 pixels and any photo location data is removed. Only verified clubs can see it.</p>
        {pending === 'upload' ? <p className="text-sm text-muted" role="status">Uploading…</p> : null}
        {error ? <p id={`${id}-err`} className="text-sm font-medium text-danger" role="alert">✕ {error}</p> : null}
        {done ? <p className="text-sm text-success" role="status">{done}</p> : null}
        {version ? (
          <div>
            <Button variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" pending={pending === 'remove'} onClick={() => void send('DELETE')}>
              Remove logo
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
