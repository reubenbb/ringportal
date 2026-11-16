'use client';
import { useEffect, useState } from 'react';
import { THEME_COOKIE, colorSchemeMeta, writePreferenceCookie, type ThemeChoice } from '@/lib/preferences';
import { Icon, type IconName } from './icons';

const OPTIONS: Array<{ value: ThemeChoice; label: string; icon: IconName }> = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'system' },
];

function apply(choice: ThemeChoice) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = colorSchemeMeta(choice);
  document.documentElement.dataset.themeChoice = choice;
}

/** Three-state theme control (light default). Choice persists in a cookie so the server renders it without a flash. */
export function ThemeToggle({ initial }: { initial: ThemeChoice }) {
  const [choice, setChoice] = useState<ThemeChoice>(initial);

  useEffect(() => {
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel('rp-theme');
      channel.onmessage = (e: MessageEvent<ThemeChoice>) => {
        setChoice(e.data);
        apply(e.data);
      };
    } catch {
      /* BroadcastChannel unavailable: other tabs update on next load */
    }
    return () => channel?.close();
  }, []);

  function select(next: ThemeChoice) {
    setChoice(next);
    apply(next);
    writePreferenceCookie(THEME_COOKIE, next);
    try {
      const ch = new BroadcastChannel('rp-theme');
      ch.postMessage(next);
      ch.close();
    } catch {
      /* ignore */
    }
  }

  return (
    <fieldset className="flex items-center rounded-md border border-line bg-surface p-0.5">
      <legend className="sr-only">Colour theme</legend>
      {OPTIONS.map((o) => (
        <label
          key={o.value}
          title={o.label}
          className="relative flex size-9 cursor-pointer items-center justify-center rounded-[5px] text-muted has-checked:bg-nav-active has-checked:text-link has-focus-visible:outline-2 has-focus-visible:outline-electric hover:text-ink"
        >
          <input type="radio" name="rp-theme" value={o.value} checked={choice === o.value} onChange={() => select(o.value)} className="sr-only" />
          <Icon name={o.icon} />
          <span className="sr-only">{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
