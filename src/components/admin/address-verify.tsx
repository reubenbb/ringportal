'use client';
import { useRouter } from 'next/navigation';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Inline verify/unverify control with a mandatory note recorded in the audit log. */
export function AddressVerify({ id, status, hasAddress }: { id: string; status: 'unverified' | 'verified'; hasAddress: boolean }) {
  const router = useRouter();
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ ok: true }>();
  const action = status === 'verified' ? 'unverify' : 'verify';

  if (action === 'verify' && !hasAddress) return <span className="text-xs text-muted">No address to verify</span>;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get('note') ?? '');
    if (await submit('POST', `/api/admin/directory/${id}/address`, { action, note })) router.refresh();
  }

  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-sm font-semibold text-link marker:hidden [&::-webkit-details-marker]:hidden">
        {action === 'verify' ? 'Mark verified' : 'Mark unverified'}
      </summary>
      <form onSubmit={onSubmit} className="mt-2 flex w-72 flex-col gap-2">
        {formError && !fieldErrors.note ? <Alert tone="danger" live>{formError}</Alert> : null}
        <label htmlFor={`note-${id}`} className="text-xs font-semibold text-ink">
          {action === 'verify' ? 'How was the address checked?' : 'Why is it no longer verified?'}
        </label>
        <textarea
          id={`note-${id}`}
          name="note"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          className="rp-input text-sm"
          aria-invalid={fieldErrors.note ? true : undefined}
          onInput={() => clearField('note')}
        />
        {fieldErrors.note ? <p className="text-xs text-danger">{fieldErrors.note}</p> : null}
        <Button type="submit" variant="secondary" pending={pending} className="min-h-9 self-start py-1.5">
          Confirm
        </Button>
      </form>
    </details>
  );
}
