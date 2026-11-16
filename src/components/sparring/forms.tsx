'use client';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useSubmit } from '@/lib/api-client';
import { formatKg } from '@/lib/boxers';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { TextArea } from '@/components/ui/text-area';

type Option = { id: string; label: string; detail?: string };

function BoxerSelect({ name, label, options, error, onChange }: { name: string; label: string; options: Option[]; error?: string; onChange: () => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      <select id={id} name={name} required defaultValue="" className="rp-input" aria-invalid={error ? true : undefined} onChange={onChange}>
        <option value="" disabled>Choose a boxer</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.detail ? ` · ${o.detail}` : ''}</option>)}
      </select>
      {error ? <p className="text-sm font-medium text-danger">✕ {error}</p> : null}
    </div>
  );
}

export function SparringRequestForm({ boxers }: { boxers: { id: string; displayName: string; ageYears: number; weightKg: number }[] }) {
  const router = useRouter();
  const { pending, fieldErrors: e, formError, submit, clearField } = useSubmit<{ id: string }>();
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const data = await submit('POST', '/api/sparring', Object.fromEntries(new FormData(ev.currentTarget).entries()));
    if (data) {
      router.push(`/sparring/${data.id}`);
      router.refresh();
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-5">
      {formError ? <Alert tone="danger" live>{formError}</Alert> : null}
      <BoxerSelect name="boxerId" label="Boxer looking for a sparring partner" options={boxers.map((b) => ({ id: b.id, label: b.displayName, detail: `${b.ageYears} yrs · ${formatKg(b.weightKg)}` }))} error={e.boxerId} onChange={() => clearField('boxerId')} />
      <Field label="When they can spar" name="availabilityNote" maxLength={300} hint="For example: Tuesday and Thursday evenings." error={e.availabilityNote} onInput={() => clearField('availabilityNote')} />
      <Field label="Where" name="location" maxLength={160} hint="Town or area, and whether you can travel." error={e.location} onInput={() => clearField('location')} />
      <TextArea label="What you are looking for" name="notes" maxLength={1000} hint="Coach-to-coach information only. No personal or medical details." error={e.notes} onChange={() => clearField('notes')} />
      <div><Button type="submit" pending={pending}>Publish sparring request</Button></div>
    </form>
  );
}

export function OfferPartnerForm({ requestId, suggestions }: { requestId: string; suggestions: { id: string; displayName: string; detail: string }[] }) {
  const router = useRouter();
  const { pending, fieldErrors: e, formError, submit, clearField } = useSubmit<{ id: string }>();
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = await submit('POST', `/api/sparring/${requestId}`, { action: 'offer', ...Object.fromEntries(new FormData(form).entries()) });
    if (data) {
      form.reset();
      router.refresh();
    }
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {formError ? <Alert tone="danger" live>{formError}</Alert> : null}
      <BoxerSelect name="boxerId" label="Your boxer" options={suggestions.map((s) => ({ id: s.id, label: s.displayName, detail: s.detail }))} error={e.boxerId} onChange={() => clearField('boxerId')} />
      <TextArea label="Note to the other coach (optional)" name="note" rows={2} maxLength={500} error={e.note} onChange={() => clearField('note')} />
      <div><Button type="submit" pending={pending}>Propose as sparring partner</Button></div>
    </form>
  );
}

export function AttendanceForm({ offerId, today }: { offerId: string; today: string }) {
  const router = useRouter();
  const [attended, setAttended] = useState(true);
  const { pending, fieldErrors: e, formError, submit, clearField } = useSubmit<{ ok: boolean }>();
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const data = await submit('POST', `/api/sparring/offers/${offerId}`, { action: 'attendance', sessionDate: f.get('sessionDate'), attended, note: f.get('note') });
    if (data) router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[12rem_1fr]">
      {formError ? <div className="sm:col-span-2"><Alert tone="danger" live>{formError}</Alert></div> : null}
      <Field label="Session date" name="sessionDate" type="date" required max={today} defaultValue={today} error={e.sessionDate} onChange={() => clearField('sessionDate')} />
      <Field label="Note (optional)" name="note" maxLength={300} error={e.note} onInput={() => clearField('note')} />
      <fieldset className="flex flex-wrap items-center gap-4 text-sm text-ink sm:col-span-2">
        <legend className="sr-only">Did your boxer attend?</legend>
        <label className="flex items-center gap-2"><input type="radio" name="attended" checked={attended} onChange={() => setAttended(true)} /> Attended</label>
        <label className="flex items-center gap-2"><input type="radio" name="attended" checked={!attended} onChange={() => setAttended(false)} /> Did not attend</label>
        <Button type="submit" variant="secondary" pending={pending}>Record</Button>
      </fieldset>
    </form>
  );
}
