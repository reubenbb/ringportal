'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

/** Reads the one-time token from the URL fragment (never sent to the server in the page request) and removes it from the address bar. */
export function ResetForm({ signInHref, forgotHref }: { signInHref: string; forgotHref: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [mismatch, setMismatch] = useState(false);
  const [done, setDone] = useState(false);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ ok: true }>();

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get('token');
    // Reading the fragment is only possible after mount; this is an external-system sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(t && /^[A-Za-z0-9_-]{32,128}$/.test(t) ? t : null);
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== form.get('confirm')) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    if (await submit('POST', '/api/auth/password-reset/confirm', { token, password })) setDone(true);
  }

  if (token === undefined) return <p className="text-sm text-muted">Checking your link…</p>;
  if (token === null) {
    return (
      <Alert tone="danger" title="This reset link is incomplete">
        Open the link from your email again, or <Link href={forgotHref}>request a new one</Link>.
      </Alert>
    );
  }
  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <Alert tone="success" title="Password updated" live>
          You have been signed out everywhere. Sign in with your new password.
        </Alert>
        <Link href={signInHref} className="font-semibold">
          Go to sign in →
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError ? (
        <Alert tone="danger" live>
          {formError} {formError.includes('expired') ? <Link href={forgotHref}>Request a new link</Link> : null}
        </Alert>
      ) : null}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={256}
        hint="At least 12 characters. A short phrase is easier to remember."
        error={fieldErrors.password}
        onInput={() => clearField('password')}
      />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={256} error={mismatch ? 'Passwords do not match' : undefined} />
      <Button type="submit" pending={pending}>
        {pending ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
