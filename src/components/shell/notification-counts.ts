'use client';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

export type CountKey = 'messages' | 'proposals';
type Summary = { unreadMessages: number; unreadConversations: number; proposalsNeedingAction: number };

const POLL_MS = 30_000;
export const REFRESH_EVENT = 'rp:notifications-refresh';
export const BROWSER_NOTIFY_KEY = 'rp-browser-notifications';

/** Ask the nav badges to refresh now (after sending a message, acting on a proposal, reading a thread). */
export function refreshNotificationCounts(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

function browserNotificationsOn(): boolean {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem(BROWSER_NOTIFY_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Polls /api/notifications (counts only) while the page is open: on load, on navigation,
 * every 30 s while visible, and when told to refresh. When the club has opted in and the
 * tab is in the background, a rise in either count shows a browser notification with
 * generic wording only: no club names, boxer details or message text.
 */
export function useNotificationCounts(enabled: boolean): Partial<Record<CountKey, number>> {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Partial<Record<CountKey, number>>>({});
  const previous = useRef<Summary | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch('/api/notifications', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const s = (await res.json()) as Summary;
      const prev = previous.current;
      if (prev && document.visibilityState === 'hidden' && browserNotificationsOn()) {
        if (s.unreadMessages > prev.unreadMessages) new Notification('RingPortal', { body: 'You have a new message from a club.', tag: 'rp-messages' });
        if (s.proposalsNeedingAction > prev.proposalsNeedingAction) new Notification('RingPortal', { body: 'A bout proposal needs your attention.', tag: 'rp-proposals' });
      }
      previous.current = s;
      setCounts({ messages: s.unreadMessages, proposals: s.proposalsNeedingAction });
    } catch {
      /* offline or signed out: keep the last counts */
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  // Refresh on navigation. Scheduled rather than called inline so state updates happen in a callback.
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const onRefresh = () => void load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
  }, [enabled, load]);

  return counts;
}
