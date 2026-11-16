import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 min-h-11';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
  danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger-bg',
};

export function buttonClass(variant: Variant = 'primary', extra = ''): string {
  return `${base} ${variants[variant]} ${extra}`;
}

export function Button({
  variant = 'primary',
  pending = false,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean }) {
  return (
    <button type={type} className={buttonClass(variant, className)} disabled={pending || props.disabled} aria-busy={pending || undefined} {...props}>
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner() {
  return <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}
