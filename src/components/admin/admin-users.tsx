'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export function CreateAdminForm() {
  const router = useRouter();
  const { pending, fieldErrors: e, formError, submit, clearField } = useSubmit<{ temporaryPassword: string }>();
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    const data = await submit('POST', '/api/admin/users', body);
    if (data) {
      setCreated({ email: String(body.email), password: data.temporaryPassword });
      form.reset();
      router.refresh();
    }
  }
  return (
    <div className="flex flex-col gap-4">
      {created ? (
        <Alert tone="warning" title="Copy this one-time password now" live>
          <p>Account created for {created.email}. This password is shown once and cannot be recovered:</p>
          <p className="my-2 select-all break-all rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink">{created.password}</p>
          <p>Give it to them by a secure route. They set up two-factor authentication at first sign-in and should then change the password under Account security.</p>
          <button type="button" className="mt-2 font-semibold text-link underline" onClick={() => setCreated(null)}>I have copied it</button>
        </Alert>
      ) : null}
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-start">
        {formError ? <div className="sm:col-span-4"><Alert tone="danger" live>{formError}</Alert></div> : null}
        <Field label="Name" name="displayName" required minLength={2} maxLength={80} autoComplete="off" error={e.displayName} onInput={() => clearField('displayName')} />
        <Field label="Email" name="email" type="email" required maxLength={254} autoComplete="off" error={e.email} onInput={() => clearField('email')} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-admin-role" className="text-sm font-semibold text-ink">Role</label>
          <select id="new-admin-role" name="role" defaultValue="admin" className="rp-input">
            <option value="admin">Administrator</option>
            <option value="owner">Platform owner</option>
          </select>
        </div>
        <div className="sm:pt-[1.625rem]"><Button type="submit" pending={pending}>Create</Button></div>
      </form>
    </div>
  );
}

const LABEL = { disable: 'Disable', enable: 'Enable', reset_mfa: 'Reset two-factor' } as const;

export function AdminUserActions({ userId, status, mfaEnabled }: { userId: string; status: 'active' | 'disabled'; mfaEnabled: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<keyof typeof LABEL | null>(null);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ ok: boolean }>();
  const available: (keyof typeof LABEL)[] = status === 'active' ? (mfaEnabled ? ['reset_mfa', 'disable'] : ['disable']) : ['enable'];
  if (!action) {
    return (
      <span className="flex flex-wrap gap-2">
        {available.map((a) => (
          <Button key={a} variant={a === 'disable' ? 'danger' : 'secondary'} className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setAction(a)}>{LABEL[a]}</Button>
        ))}
      </span>
    );
  }
  return (
    <form
      className="flex w-72 flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = await submit('POST', `/api/admin/users/${userId}`, { action, reason: String(new FormData(e.currentTarget).get('reason') ?? '') });
        if (data) {
          setAction(null);
          router.refresh();
        }
      }}
    >
      <Field label={`Reason to ${LABEL[action].toLowerCase()}`} name="reason" required minLength={5} maxLength={500} error={fieldErrors.reason ?? formError ?? undefined} onInput={() => clearField('reason')} />
      <span className="flex gap-2">
        <Button type="submit" variant={action === 'disable' ? 'danger' : 'primary'} pending={pending} className="min-h-9 px-3 py-1.5 text-xs">Confirm</Button>
        <Button variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setAction(null)}>Cancel</Button>
      </span>
    </form>
  );
}
