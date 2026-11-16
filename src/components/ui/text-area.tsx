import { useId, type TextareaHTMLAttributes } from 'react';

/** Labelled textarea with hint and server error, matching Field. */
export function TextArea({ label, hint, error, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <textarea id={id} rows={3} className="rp-input" aria-invalid={error ? true : undefined} aria-describedby={[hint ? `${id}-h` : '', error ? `${id}-e` : ''].filter(Boolean).join(' ') || undefined} {...props} />
      {hint ? <p id={`${id}-h`} className="text-xs text-muted">{hint}</p> : null}
      {error ? <p id={`${id}-e`} className="text-sm font-medium text-danger">✕ {error}</p> : null}
    </div>
  );
}
