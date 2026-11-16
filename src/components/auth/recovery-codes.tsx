'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/** Shows freshly issued recovery codes once, with copy and download. */
export function RecoveryCodes({ codes, onDone, doneLabel = 'I have saved these codes' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const text = `RingPortal admin recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ringportal-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="grid grid-cols-2 gap-2 rounded-md border border-line bg-surface-2 p-4 font-mono text-sm text-ink">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" onClick={download}>
          Download
        </Button>
      </div>
      <p className="text-sm text-muted">Store these somewhere safe and separate from your phone. They will not be shown again.</p>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 size-4" />
        I have stored these recovery codes securely.
      </label>
      <Button onClick={onDone} disabled={!confirmed}>
        {doneLabel}
      </Button>
    </div>
  );
}
