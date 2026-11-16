'use client';
import { useRef, useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export function ChangePasswordForm({ endpoint }: { endpoint: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [mismatch, setMismatch] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ revokedOtherSessions: number }>();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSuccess(null);
    const form = new FormData(e.currentTarget);
    if (form.get('newPassword') !== form.get('confirm')) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    const data = await submit('POST', endpoint, { currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') });
    if (data) {
      formRef.current?.reset();
      setSuccess(
        data.revokedOtherSessions > 0
          ? `Password changed. ${data.revokedOtherSessions} other signed-in ${data.revokedOtherSessions === 1 ? 'device was' : 'devices were'} signed out.`
          : 'Password changed.',
      );
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex max-w-md flex-col gap-5">
      {success ? <Alert tone="success" live>{success}</Alert> : null}
      {formError && Object.keys(fieldErrors).length === 0 ? <Alert tone="danger" live>{formError}</Alert> : null}
      <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} error={fieldErrors.currentPassword} onInput={() => clearField('currentPassword')} />
      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={256}
        hint="At least 12 characters."
        error={fieldErrors.newPassword}
        onInput={() => clearField('newPassword')}
      />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={256} error={mismatch ? 'Passwords do not match' : undefined} />
      <Button type="submit" pending={pending} className="self-start">
        {pending ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  );
}
