'use client';
import { useId } from 'react';
import { Field } from '@/components/ui/field';
import { BOUT_TYPES, BOUT_TYPE_LABEL, ukToday, type Terms } from '@/lib/proposals';

type Props = {
  initial: Partial<Terms>;
  fieldErrors: Record<string, string>;
  clearField: (name: string) => void;
  /** Prefix for server field names, e.g. "terms." when nested in an action body. */
  errorPrefix?: string;
  onWeightChange?: (kg: number | undefined) => void;
};

function Err({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm font-medium text-danger">
      <span aria-hidden="true">✕</span>
      {message}
    </p>
  );
}

/** The material terms of a bout. Changing any of them creates a new version. */
export function TermsFields({ initial, fieldErrors, clearField, errorPrefix = '', onWeightChange }: Props) {
  const id = useId();
  const e = (k: keyof Terms) => fieldErrors[`${errorPrefix}${k}`];
  const clear = (k: keyof Terms) => clearField(`${errorPrefix}${k}`);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field
        label="Proposed date"
        name="proposedDate"
        type="date"
        min={ukToday()}
        defaultValue={initial.proposedDate ?? ''}
        hint="Optional at this stage."
        error={e('proposedDate')}
        onChange={() => clear('proposedDate')}
      />
      <Field
        label="Proposed weight (kg)"
        name="weightKg"
        type="number"
        inputMode="decimal"
        required
        min={20}
        max={200}
        step={0.1}
        defaultValue={initial.weightKg ?? ''}
        error={e('weightKg')}
        onChange={(ev) => {
          clear('weightKg');
          const v = Number(ev.currentTarget.value);
          onWeightChange?.(ev.currentTarget.value && Number.isFinite(v) ? v : undefined);
        }}
      />
      <fieldset className="sm:col-span-2" aria-describedby={e('boutType') ? `${id}-type-err` : undefined}>
        <legend className="text-sm font-semibold text-ink">Bout type</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {BOUT_TYPES.map((t) => (
            <label key={t} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-sm font-semibold text-ink has-[:checked]:border-electric has-[:checked]:bg-nav-active">
              <input type="radio" name="boutType" value={t} required defaultChecked={(initial.boutType ?? 'competitive') === t} onChange={() => clear('boutType')} />
              {BOUT_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">Skills bouts are recorded separately and never count towards a competitive record.</p>
        <Err id={`${id}-type-err`} message={e('boutType')} />
      </fieldset>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={`${id}-travel`} className="text-sm font-semibold text-ink">
          Travel arrangements
        </label>
        <textarea
          id={`${id}-travel`}
          name="travel"
          rows={2}
          maxLength={500}
          defaultValue={initial.travel ?? ''}
          className="rp-input"
          placeholder="For example: away club travels; venue details to follow"
          aria-invalid={e('travel') ? true : undefined}
          aria-describedby={e('travel') ? `${id}-travel-err` : undefined}
          onChange={() => clear('travel')}
        />
        <Err id={`${id}-travel-err`} message={e('travel')} />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor={`${id}-terms`} className="text-sm font-semibold text-ink">
          Other terms and notes
        </label>
        <textarea
          id={`${id}-terms`}
          name="terms"
          rows={3}
          maxLength={1000}
          defaultValue={initial.terms ?? ''}
          className="rp-input"
          placeholder="For example: rounds, weigh-in time, show name"
          aria-invalid={e('terms') ? true : undefined}
          aria-describedby={e('terms') ? `${id}-terms-err` : undefined}
          onChange={() => clear('terms')}
        />
        <Err id={`${id}-terms-err`} message={e('terms')} />
      </div>
    </div>
  );
}

/** Reads the terms fields from a form. */
export function readTerms(form: FormData) {
  return {
    proposedDate: String(form.get('proposedDate') ?? '') || null,
    weightKg: form.get('weightKg'),
    boutType: form.get('boutType'),
    travel: String(form.get('travel') ?? ''),
    terms: String(form.get('terms') ?? ''),
  };
}
