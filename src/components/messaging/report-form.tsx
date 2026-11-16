'use client';
import { useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextArea } from '@/components/ui/text-area';

/** Report a conversation to RingPortal administrators, or (admin) resolve a report. */
export function ReasonForm({ endpoint, field, openLabel, label, hint, submitLabel, doneText }: { endpoint: string; field: 'reason' | 'resolution'; openLabel: string; label: string; hint: string; submitLabel: string; doneText: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ ok: boolean }>();
  if (done) return <Alert tone="success" live>{doneText}</Alert>;
  if (!open) return <Button variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>{openLabel}</Button>;
  return (
    <form
      className="flex max-w-xl flex-col gap-3 rounded-md border border-line p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = await submit('POST', endpoint, { [field]: String(new FormData(e.currentTarget).get(field) ?? '') });
        if (data) setDone(true);
      }}
    >
      {formError ? <Alert tone="danger" live>{formError}</Alert> : null}
      <TextArea label={label} name={field} required maxLength={1000} hint={hint} error={fieldErrors[field]} onChange={() => clearField(field)} />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" pending={pending}>{submitLabel}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
