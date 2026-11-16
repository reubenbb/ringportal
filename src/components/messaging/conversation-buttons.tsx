'use client';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/api-client';
import { Button, buttonClass } from '@/components/ui/button';
import { Icon } from '@/components/shell/icons';
import { BROWSER_NOTIFY_KEY } from '@/components/shell/notification-counts';

/** Opens (finding or creating) a general or boxer conversation, then goes to it. */
export function MessageButton({
  target,
  label,
  variant = 'secondary',
  compact,
}: {
  target: { kind: 'general'; clubId: string } | { kind: 'boxer'; boxerId: string };
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    setPending(true);
    setError(null);
    const res = await api<{ id: string }>('POST', '/api/conversations', target);
    setPending(false);
    if (res.ok) router.push(`/messages/${res.data.id}`);
    else setError(res.error.message);
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant={variant} pending={pending} onClick={() => void open()} className={compact ? 'min-h-9 px-3 py-1.5 text-xs' : ''}>
        {compact ? null : <Icon name="messages" />}
        {label}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

export function ArchiveConversationButton({ conversationId, archived }: { conversationId: string; archived: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggleArchive() {
    setPending(true);
    const res = await api('POST', `/api/conversations/${conversationId}/archive`, { archived: !archived });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    router.push(archived ? `/messages/${conversationId}` : '/messages');
    router.refresh();
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant="secondary" pending={pending} onClick={() => void toggleArchive()}>
        {archived ? 'Move to inbox' : 'Archive'}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}

// Browser notifications ------------------------------------------------------------

type NotifyState = 'unsupported' | 'denied' | 'on' | 'off';
const NOTIFY_CHANGED = 'rp:browser-notify-changed';

function readNotifyState(): NotifyState {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return Notification.permission === 'granted' && localStorage.getItem(BROWSER_NOTIFY_KEY) === 'on' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function subscribeNotify(onChange: () => void) {
  window.addEventListener(NOTIFY_CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(NOTIFY_CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function setNotifyPreference(value: 'on' | 'off') {
  try {
    localStorage.setItem(BROWSER_NOTIFY_KEY, value);
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(NOTIFY_CHANGED));
}

/**
 * Opt-in browser notifications. Shown only while RingPortal is open in a background tab,
 * with generic wording (never club names, boxer details or message text).
 */
export function BrowserNotificationsToggle() {
  // Server snapshot is null so the server render and first client render match.
  const state = useSyncExternalStore<NotifyState | null>(subscribeNotify, readNotifyState, () => null);

  if (state === null || state === 'unsupported') return null;
  if (state === 'denied') return <p className="text-xs text-muted">Browser notifications are blocked for RingPortal in your browser settings.</p>;

  async function toggleNotify() {
    if (state === 'on') return setNotifyPreference('off');
    const permission = await Notification.requestPermission();
    setNotifyPreference(permission === 'granted' ? 'on' : 'off');
  }

  return (
    <button type="button" onClick={() => void toggleNotify()} className={buttonClass('ghost', 'min-h-9 px-3 py-1.5 text-xs')} aria-pressed={state === 'on'}>
      {state === 'on' ? 'Browser notifications on' : 'Turn on browser notifications'}
    </button>
  );
}
