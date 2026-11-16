import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';
const tones: Record<Tone, { cls: string; icon: string; label: string }> = {
  info: { cls: 'border-line bg-surface-2 text-ink', icon: 'ℹ', label: 'Information' },
  success: { cls: 'border-success/30 bg-success-bg text-success', icon: '✓', label: 'Success' },
  warning: { cls: 'border-warning/30 bg-warning-bg text-warning', icon: '!', label: 'Warning' },
  danger: { cls: 'border-danger/30 bg-danger-bg text-danger', icon: '✕', label: 'Error' },
};

export function Alert({ tone = 'info', title, children, live = false }: { tone?: Tone; title?: string; children?: ReactNode; live?: boolean }) {
  const t = tones[tone];
  return (
    <div role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined} className={`flex gap-3 rounded-md border px-4 py-3 text-sm ${t.cls}`}>
      <span aria-hidden="true" className="font-bold">
        {t.icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="sr-only">{t.label}: </span>
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-ink/90">{children}</div> : null}
      </div>
    </div>
  );
}
