'use client';
import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { RecoveryCodes } from '@/components/auth/recovery-codes';
import { MfaSetup } from '@/components/auth/mfa-enrol';

/** Step-up with a current TOTP code, then show new recovery codes. */
export function RegenerateRecoveryCodes({ remaining }: { remaining: number }) {
  const router = useRouter();
  const [codes, setCodes] = useState<string[] | null>(null);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ recoveryCodes: string[] }>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = await submit('POST', '/api/admin/account/recovery-codes', { code: String(new FormData(e.currentTarget).get('code') ?? '').trim() });
    if (data) setCodes(data.recoveryCodes);
  }

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        doneLabel="Done"
        onDone={() => {
          setCodes(null);
          router.refresh();
        }}
      />
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <p className="text-sm text-ink">
        {remaining} unused recovery {remaining === 1 ? 'code' : 'codes'} remaining. Generating new codes invalidates all existing ones.
      </p>
      {remaining <= 3 ? <Alert tone="warning">You are running low on recovery codes. Generate a new set.</Alert> : null}
      {formError && !fieldErrors.code ? <Alert tone="danger" live>{formError}</Alert> : null}
      <Field label="Current authentication code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required error={fieldErrors.code} onInput={() => clearField('code')} />
      <Button type="submit" variant="secondary" pending={pending} className="self-start">
        Generate new recovery codes
      </Button>
    </form>
  );
}

/** Rotate the authenticator: current code → new QR → confirm with new code. Other admin sessions are signed out. */
export function RotateAuthenticator() {
  const [stage, setStage] = useState<'idle' | 'setup' | 'done'>('idle');
  const [startCode, setStartCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ uri: string; qrSvg: string; secret: string }>();
  const [payload, setPayload] = useState<{ uri: string; qrSvg: string; secret: string } | null>(null);

  const load = useCallback(async () => (payload ? { ok: true as const, data: payload } : { ok: false as const, error: { message: 'Start again' } }), [payload]);

  async function onStart(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = await submit('POST', '/api/admin/account/mfa/rotate', { code: startCode.trim() });
    if (data) {
      setPayload(data);
      setStage('setup');
    }
  }

  if (stage === 'done') return <Alert tone="success" live>{message}</Alert>;
  if (stage === 'setup' && payload) {
    return (
      <div className="max-w-md">
        <MfaSetup
          load={load}
          confirmPath="/api/admin/account/mfa/confirm"
          completeLabel="Switch to new authenticator"
          onComplete={() => {
            setMessage('Your new authenticator is active. Other admin sessions for this account have been signed out.');
            setStage('done');
          }}
        />
      </div>
    );
  }
  return (
    <form onSubmit={onStart} className="flex max-w-md flex-col gap-4">
      <p className="text-sm text-ink">Use this when you change phone or authenticator app. You need a code from your current authenticator to start.</p>
      {formError && !fieldErrors.code ? <Alert tone="danger" live>{formError}</Alert> : null}
      <Field
        label="Current authentication code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={startCode}
        onChange={(e) => {
          setStartCode(e.target.value);
          clearField('code');
        }}
        error={fieldErrors.code}
      />
      <Button type="submit" variant="secondary" pending={pending} className="self-start">
        Set up a new authenticator
      </Button>
    </form>
  );
}

