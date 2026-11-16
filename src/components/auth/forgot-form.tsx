'use client';
import { useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export function ForgotForm({ audience }: { audience: 'club' | 'admin' }) {
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ message: string }>();
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = await submit('POST', '/api/auth/password-reset/request', { email: new FormData(e.currentTarget).get('email'), audience });
    if (data) setSent(data.message);
  }

  if (sent) {
    return (
      <Alert tone="success" title="Check your email" live>
        {sent} The link expires after 30 minutes.
      </Alert>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {formError ? (
        <Alert tone="danger" live>
          {formError}
        </Alert>
      ) : null}
      <Field label="Email" name="email" type="email" autoComplete="username" required maxLength={254} error={fieldErrors.email} onInput={() => clearField('email')} />
      <Button type="submit" pending={pending}>
        {pending ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
