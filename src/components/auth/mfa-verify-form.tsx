'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export function MfaVerifyForm() {
  const router = useRouter();
  const [useRecovery, setUseRecovery] = useState(false);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ ok: true }>();
  const expired = formError?.includes('expired');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get('code') ?? '').trim();
    const ok = await submit('POST', '/api/admin/auth/mfa', useRecovery ? { recoveryCode: value } : { code: value });
    if (ok) {
      router.replace('/admin');
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError && !fieldErrors.code ? (
        <Alert tone="danger" live>
          {formError} {expired ? <Link href="/admin/login">Sign in again</Link> : null}
        </Alert>
      ) : null}
      {useRecovery ? (
        <Field key="recovery" label="Recovery code" name="code" autoComplete="off" spellCheck={false} required maxLength={32} placeholder="xxxx-xxxx-xxxx" error={fieldErrors.code} onInput={() => clearField('code')} />
      ) : (
        <Field
          key="totp"
          label="Authentication code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          hint="The 6-digit code from your authenticator app."
          error={fieldErrors.code}
          onInput={() => clearField('code')}
        />
      )}
      <Button type="submit" pending={pending}>
        {pending ? 'Verifying…' : 'Verify'}
      </Button>
      <button type="button" className="self-start text-sm font-semibold text-link" onClick={() => setUseRecovery((v) => !v)}>
        {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
      </button>
    </form>
  );
}
