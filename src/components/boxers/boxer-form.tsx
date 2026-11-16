'use client';
import { useRouter } from 'next/navigation';
import { useSubmit } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

type Values = {
  firstName: string;
  lastName: string;
  sex: 'male' | 'female' | '';
  dateOfBirth: string;
  weightKg: number | '';
  competitiveWins: number;
  competitiveLosses: number;
  competitiveDraws: number;
  skillsBouts: number;
  medicalStatus: string;
  notes: string;
};

export const EMPTY_BOXER: Values = {
  firstName: '',
  lastName: '',
  sex: '',
  dateOfBirth: '',
  weightKg: '',
  competitiveWins: 0,
  competitiveLosses: 0,
  competitiveDraws: 0,
  skillsBouts: 0,
  medicalStatus: '',
  notes: '',
};

export function BoxerForm({ boxerId, initial }: { boxerId?: string; initial: Values }) {
  const router = useRouter();
  const { pending, fieldErrors, formError, submit, clearField } = useSubmit<{ id?: string; ok?: boolean }>();
  const today = new Date().toISOString().slice(0, 10);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries(f.entries());
    const data = boxerId ? await submit('PUT', `/api/boxers/${boxerId}`, body) : await submit('POST', '/api/boxers', body);
    if (data) {
      router.push(boxerId ? `/boxers/${boxerId}?saved=1` : `/boxers/${data.id}?created=1`);
      router.refresh();
    }
  }

  const num = (name: keyof Values, label: string) => (
    <Field
      label={label}
      name={name}
      type="number"
      inputMode="numeric"
      min={0}
      max={999}
      step={1}
      required
      defaultValue={initial[name] as number}
      error={fieldErrors[name]}
      onInput={() => clearField(name)}
    />
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate={false}>
      {formError && Object.keys(fieldErrors).length === 0 ? (
        <Alert tone="danger" live>
          {formError}
        </Alert>
      ) : null}
      {Object.keys(fieldErrors).length > 0 ? (
        <Alert tone="danger" live>
          Check the highlighted fields.
        </Alert>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">Boxer</legend>
        <Field label="First name" name="firstName" autoComplete="off" required maxLength={60} defaultValue={initial.firstName} error={fieldErrors.firstName} onInput={() => clearField('firstName')} />
        <Field label="Surname" name="lastName" autoComplete="off" required maxLength={60} defaultValue={initial.lastName} error={fieldErrors.lastName} onInput={() => clearField('lastName')} />
        <Field
          label="Date of birth"
          name="dateOfBirth"
          type="date"
          required
          min="1940-01-01"
          max={today}
          defaultValue={initial.dateOfBirth}
          hint="Private to your club. Other clubs see age only."
          error={fieldErrors.dateOfBirth}
          onInput={() => clearField('dateOfBirth')}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sex" className="text-sm font-semibold text-ink">
            Sex / category
          </label>
          <select id="sex" name="sex" required defaultValue={initial.sex} className="rp-input" aria-invalid={fieldErrors.sex ? true : undefined} onChange={() => clearField('sex')}>
            <option value="" disabled>
              Choose…
            </option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
          {fieldErrors.sex ? <p className="text-sm font-medium text-danger">✕ {fieldErrors.sex}</p> : null}
        </div>
        <Field
          label="Current weight (kg)"
          name="weightKg"
          type="number"
          inputMode="decimal"
          min={20}
          max={200}
          step={0.1}
          required
          defaultValue={initial.weightKg}
          error={fieldErrors.weightKg}
          onInput={() => clearField('weightKg')}
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Competitive record</legend>
        {num('competitiveWins', 'Wins')}
        {num('competitiveLosses', 'Losses')}
        {num('competitiveDraws', 'Draws')}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Skills bouts</legend>
        {num('skillsBouts', 'Skills bouts')}
        <p className="self-end text-xs text-muted sm:col-span-2">Recorded separately. Skills bouts are never added to the competitive record.</p>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-2 text-sm font-semibold text-ink">Private to your club</legend>
        <Field label="Eligibility / medical status" name="medicalStatus" maxLength={500} defaultValue={initial.medicalStatus} hint="Never shown to other clubs." error={fieldErrors.medicalStatus} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="notes" className="text-sm font-semibold text-ink">
            Internal notes
          </label>
          <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={initial.notes} className="rp-input" />
          <p className="text-xs text-muted">Only your club can see these notes.</p>
        </div>
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" pending={pending}>
          {pending ? 'Saving…' : boxerId ? 'Save changes' : 'Add boxer'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
