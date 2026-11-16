'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { RecoveryCodes } from './recovery-codes';

type Payload = { uri: string; qrSvg: string; secret: string };

/** QR + manual key, confirm code, then show recovery codes. Used for first enrolment and rotation. */
export function MfaSetup({
  load,
  confirmPath,
  onComplete,
  completeLabel,
}: {
  load: () => Promise<{ ok: true; data: Payload } | { ok: false; error: { message: string } }>;
  confirmPath: string;
  onComplete: (codes: string[] | null) => void;
  completeLabel: string;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ recoveryCodes?: string[] }>();

  useEffect(() => {
    let live = true;
    load().then((r) => {
      if (!live) return;
      if (r.ok) setPayload(r.data);
      else setLoadError(r.error.message);
    });
    return () => {
      live = false;
    };
  }, [load]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = await submit('POST', confirmPath, { code: String(new FormData(e.currentTarget).get('code') ?? '').trim() });
    if (data) onComplete(data.recoveryCodes ?? null);
  }

  if (loadError) return <Alert tone="danger" live>{loadError}</Alert>;
  if (!payload) return <p className="text-sm text-muted">Preparing your authenticator setup…</p>;
  return (
    <div className="flex flex-col gap-6">
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-ink">
        <li>Open an authenticator app (for example 1Password, Google Authenticator or Microsoft Authenticator).</li>
        <li>Scan the QR code, or enter the key manually.</li>
        <li>Enter the 6-digit code it shows.</li>
      </ol>
      {/* QR SVG is generated server-side by our own code from the otpauth URI; it contains no user-supplied markup. */}
      <div className="w-48 self-center rounded-md bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: payload.qrSvg }} role="img" aria-label="QR code for your authenticator app" />
      <div>
        <p className="text-xs font-semibold text-muted">Manual key</p>
        <p className="mt-1 break-all rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink">{payload.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {formError && !fieldErrors.code ? <Alert tone="danger" live>{formError}</Alert> : null}
        <Field label="Authentication code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required error={fieldErrors.code} onInput={() => clearField('code')} />
        <Button type="submit" pending={pending}>
          {pending ? 'Checking…' : completeLabel}
        </Button>
      </form>
    </div>
  );
}

const loadEnrolment = () => api<Payload>('POST', '/api/admin/auth/enrol/start');

export function FirstEnrolment() {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title="Two-factor authentication is on" live>
          Save your recovery codes. You need one if you lose your authenticator.
        </Alert>
        <RecoveryCodes
          codes={codes}
          doneLabel="Continue to admin"
          onDone={() => {
            router.replace('/admin');
            router.refresh();
          }}
        />
      </div>
    );
  }
  return (
    <>
      <MfaSetup load={loadEnrolment} confirmPath="/api/admin/auth/enrol/confirm" completeLabel="Turn on two-factor authentication" onComplete={(c) => setCodes(c ?? [])} />
      <p className="mt-6 text-sm text-muted">
        Sign-in expired? <Link href="/admin/login">Start again</Link>
      </p>
    </>
  );
}
