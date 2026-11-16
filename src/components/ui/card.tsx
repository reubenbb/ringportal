import type { ReactNode } from 'react';

export function Card({ title, description, actions, children, className = '' }: { title?: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          {actions}
        </header>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="rp-eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="rp-display text-4xl text-ink">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

type BadgeTone = 'neutral' | 'blue' | 'success' | 'warning' | 'danger' | 'gold';
const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted border-line',
  blue: 'bg-nav-active text-link border-electric/30',
  success: 'bg-success-bg text-success border-success/30',
  warning: 'bg-warning-bg text-warning border-warning/30',
  danger: 'bg-danger-bg text-danger border-danger/30',
  gold: 'bg-surface text-gold-ink border-gold/60',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold ${badgeTones[tone]}`}>{children}</span>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-5 py-4">
      <p className="rp-eyebrow">{label}</p>
      <p className="rp-display mt-2 text-4xl text-ink tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
