'use client';
import { useRouter } from 'next/navigation';
import { useId } from 'react';
import { useSubmit } from '@/lib/api-client';
import { formatKg } from '@/lib/boxers';
import { BOUT_TYPES, BOUT_TYPE_LABEL, ukToday } from '@/lib/proposals';
import { formatShowDate } from '@/lib/shows';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { TextArea } from '@/components/ui/text-area';

export type ShowFormValues = { name: string; date: string; time: string; venue: string; postcode: string; contactRoute: string; requirements: string; info: string; listedPublicly: boolean };

export function ShowForm({ showId, initial }: { showId?: string; initial?: ShowFormValues }) {
  const router = useRouter();
  const { pending, fieldErrors: e, formError, submit, clearField } = useSubmit<{ id?: string }>();
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body = { ...Object.fromEntries(f.entries()), listedPublicly: f.get('listedPublicly') === 'on' };
    const data = showId ? await submit('PUT', `/api/shows/${showId}`, body) : await submit('POST', '/api/shows', body);
    if (data) {
      router.push(`/shows/${showId ?? data.id}`);
      router.refresh();
    }
  }
  const c = (n: string) => () => clearField(n);
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-5 sm:grid-cols-2">
      {formError ? <div className="sm:col-span-2"><Alert tone="danger" live>{formError}</Alert></div> : null}
      <Field className="sm:col-span-2" label="Show name" name="name" required minLength={3} maxLength={120} defaultValue={initial?.name} error={e.name} onInput={c('name')} />
      <Field label="Date" name="date" type="date" required min={ukToday()} defaultValue={initial?.date} error={e.date} onChange={c('date')} />
      <Field label="Start time" name="time" type="time" required defaultValue={initial?.time ?? '19:00'} hint="UK time." error={e.time} onChange={c('time')} />
      <Field label="Venue" name="venue" required maxLength={160} defaultValue={initial?.venue} error={e.venue} onInput={c('venue')} />
      <Field label="Venue postcode" name="postcode" required maxLength={10} autoCapitalize="characters" defaultValue={initial?.postcode} error={e.postcode} onInput={c('postcode')} />
      <div className="sm:col-span-2">
        <TextArea label="Boxers and weights needed" name="requirements" maxLength={1000} defaultValue={initial?.requirements} placeholder="For example: 2 × senior 64 kg, 1 × junior 48 kg" error={e.requirements} onChange={c('requirements')} />
      </div>
      <div className="sm:col-span-2">
        <TextArea label="How clubs should contact you" name="contactRoute" rows={2} maxLength={300} defaultValue={initial?.contactRoute} hint="Seen by verified clubs only, never on the public calendar. Clubs can always message you through RingPortal." error={e.contactRoute} onChange={c('contactRoute')} />
      </div>
      <div className="sm:col-span-2">
        <TextArea label="Additional information" name="info" maxLength={2000} defaultValue={initial?.info} hint="Seen by verified clubs only." error={e.info} onChange={c('info')} />
      </div>
      <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2">
        <input type="checkbox" name="listedPublicly" defaultChecked={initial?.listedPublicly ?? true} className="mt-1" />
        <span>List on the public show calendar <span className="text-muted">(name, date, host club, venue and postcode area only)</span></span>
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" pending={pending}>{showId ? 'Save changes' : 'List show'}</Button>
      </div>
    </form>
  );
}

export type RequestFormValues = { showId: string; boxerId: string; sex: string; minAge: number | ''; maxAge: number | ''; weightKg: number | ''; boutType: string; experience: string; neededOn: string; location: string; requirements: string };
type BoxerOption = { id: string; displayName: string; sex: 'male' | 'female'; ageYears: number; weightKg: number };

export function RequestForm({ requestId, initial, shows, boxers }: { requestId?: string; initial: RequestFormValues; shows: { id: string; name: string; startsAt: string }[]; boxers: BoxerOption[] }) {
  const router = useRouter();
  const id = useId();
  const { pending, fieldErrors: e, formError, submit, clearField } = useSubmit<{ id?: string }>();
  async function onSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.currentTarget).entries());
    const data = requestId ? await submit('PUT', `/api/opponent-requests/${requestId}`, body) : await submit('POST', '/api/opponent-requests', body);
    if (data) {
      router.push('/shows?tab=mine');
      router.refresh();
    }
  }
  // Choosing one of your boxers fills in the criteria; you can still adjust them.
  function fill(ev: React.ChangeEvent<HTMLSelectElement>) {
    clearField('boxerId');
    const b = boxers.find((x) => x.id === ev.target.value);
    const form = ev.target.form;
    if (!b || !form) return;
    const set = (name: string, value: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = value;
    };
    set('sex', b.sex);
    set('minAge', String(Math.max(8, b.ageYears - (b.ageYears < 18 ? 1 : 5))));
    set('maxAge', String(b.ageYears < 18 ? Math.min(17, b.ageYears + 1) : b.ageYears + 5));
    set('weightKg', String(b.weightKg));
  }
  const c = (n: string) => () => clearField(n);
  const sel = (name: string, label: string, children: React.ReactNode, opts: { required?: boolean; onChange?: (ev: React.ChangeEvent<HTMLSelectElement>) => void; hint?: string } = {}) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-${name}`} className="text-sm font-semibold text-ink">{label}</label>
      <select id={`${id}-${name}`} name={name} required={opts.required} defaultValue={initial[name as keyof RequestFormValues]} className="rp-input" aria-invalid={e[name] ? true : undefined} onChange={opts.onChange ?? c(name)}>
        {children}
      </select>
      {opts.hint ? <p className="text-xs text-muted">{opts.hint}</p> : null}
      {e[name] ? <p className="text-sm font-medium text-danger">✕ {e[name]}</p> : null}
    </div>
  );
  return (
    <form onSubmit={onSubmit} className="grid max-w-3xl gap-5 sm:grid-cols-2">
      {formError ? <div className="sm:col-span-2"><Alert tone="danger" live>{formError}</Alert></div> : null}
      {sel('showId', 'For a show', <><option value="">Not linked to a show</option>{shows.map((s) => <option key={s.id} value={s.id}>{s.name} · {formatShowDate(s.startsAt)}</option>)}</>)}
      {sel('boxerId', 'For your boxer', <><option value="">Not linked to a boxer</option>{boxers.map((b) => <option key={b.id} value={b.id}>{b.displayName} · {b.ageYears} yrs · {formatKg(b.weightKg)}</option>)}</>, { onChange: fill, hint: 'Optional. Lets other clubs propose a bout with this boxer directly.' })}
      {sel('sex', 'Sex / category', <><option value="" disabled>Choose</option><option value="male">Male</option><option value="female">Female</option></>, { required: true })}
      {sel('boutType', 'Bout type', BOUT_TYPES.map((t) => <option key={t} value={t}>{BOUT_TYPE_LABEL[t]}</option>), { required: true })}
      <Field label="Minimum age" name="minAge" type="number" inputMode="numeric" required min={8} max={80} defaultValue={initial.minAge} error={e.minAge} onInput={c('minAge')} />
      <Field label="Maximum age" name="maxAge" type="number" inputMode="numeric" required min={8} max={80} defaultValue={initial.maxAge} error={e.maxAge} onInput={c('maxAge')} />
      <Field label="Weight (kg)" name="weightKg" type="number" inputMode="decimal" required min={20} max={200} step={0.1} defaultValue={initial.weightKg} error={e.weightKg} onInput={c('weightKg')} />
      <Field label="Experience wanted" name="experience" maxLength={200} defaultValue={initial.experience} hint="For example: 0–5 competitive bouts, or up to 3 skills bouts." error={e.experience} onInput={c('experience')} />
      <Field label="Date needed" name="neededOn" type="date" defaultValue={initial.neededOn} hint="Optional." error={e.neededOn} onChange={c('neededOn')} />
      <Field label="Location" name="location" maxLength={160} defaultValue={initial.location} hint="Town or area." error={e.location} onInput={c('location')} />
      <div className="sm:col-span-2">
        <TextArea label="Additional requirements" name="requirements" maxLength={1000} defaultValue={initial.requirements} hint="Do not include names or personal details of junior boxers." error={e.requirements} onChange={c('requirements')} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" pending={pending}>{requestId ? 'Save changes' : 'Publish request'}</Button>
      </div>
    </form>
  );
}
