'use client';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { MESSAGE_MAX, QUICK_REPLIES, formatMessageTime } from '@/lib/messaging';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/shell/icons';
import { refreshNotificationCounts } from '@/components/shell/notification-counts';
import type { MessageView } from '@/server/messaging/service';

type Props = {
  conversationId: string;
  initialMessages: MessageView[];
  hasEarlier: boolean;
  lastReadMessageId: number;
  otherClubName: string;
  canSend: boolean;
  /** Shorter scroll area when embedded in another page. */
  compact?: boolean;
};

const POLL_MS = 10_000;

export function Thread({ conversationId, initialMessages, hasEarlier: initialHasEarlier, lastReadMessageId, otherClubName, canSend, compact }: Props) {
  const composerId = useId();
  const countId = useId();
  const [items, setItems] = useState<MessageView[]>(initialMessages);
  const [hasEarlier, setHasEarlier] = useState(initialHasEarlier);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firstUnread] = useState(() => initialMessages.find((m) => !m.fromMe && m.id > lastReadMessageId)?.id ?? null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const readUpTo = useRef(lastReadMessageId);
  const stickToBottom = useRef(true);
  const prependAnchor = useRef<number | null>(null);

  const lastId = items.length ? items[items.length - 1]!.id : 0;

  // Keep the newest message in view unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependAnchor.current !== null) {
      el.scrollTop = el.scrollHeight - prependAnchor.current;
      prependAnchor.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items]);

  const markRead = useCallback(async () => {
    if (document.visibilityState !== 'visible' || lastId <= readUpTo.current) return;
    const res = await api<{ lastReadMessageId: number }>('POST', `/api/conversations/${conversationId}/read`, { upToId: lastId });
    if (res.ok) {
      readUpTo.current = res.data.lastReadMessageId;
      refreshNotificationCounts();
    }
  }, [conversationId, lastId]);

  useEffect(() => {
    void markRead();
  }, [markRead]);

  const poll = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    const res = await api<{ items: MessageView[] }>('GET', `/api/conversations/${conversationId}/messages?after=${lastId}`);
    if (res.ok && res.data.items.length) {
      setItems((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...res.data.items.filter((m) => !seen.has(m.id))];
      });
    }
  }, [conversationId, lastId]);

  useEffect(() => {
    const t = window.setInterval(() => void poll(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void poll();
        void markRead();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll, markRead]);

  async function loadEarlier() {
    if (!items.length) return;
    setLoadingEarlier(true);
    const res = await api<{ items: MessageView[]; hasEarlier: boolean }>('GET', `/api/conversations/${conversationId}/messages?before=${items[0]!.id}`);
    setLoadingEarlier(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    const el = scroller.current;
    prependAnchor.current = el ? el.scrollHeight - el.scrollTop : null;
    setItems((prev) => [...res.data.items, ...prev]);
    setHasEarlier(res.data.hasEarlier);
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const res = await api<MessageView>('POST', `/api/conversations/${conversationId}/messages`, { body });
    setSending(false);
    if (!res.ok) {
      setError(res.error.fields?.body ?? res.error.message);
      return;
    }
    stickToBottom.current = true;
    readUpTo.current = Math.max(readUpTo.current, res.data.id);
    setItems((prev) => (prev.some((m) => m.id === res.data.id) ? prev : [...prev, res.data]));
    setDraft('');
    composer.current?.focus();
    refreshNotificationCounts();
  }

  const remaining = MESSAGE_MAX - draft.length;

  return (
    <div className="flex flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={`overflow-y-auto rounded-md border border-line bg-surface-2/40 p-3 ${compact ? 'h-80' : 'h-[min(60dvh,36rem)]'}`}
        tabIndex={0}
        aria-label={`Messages with ${otherClubName}`}
      >
        {hasEarlier ? (
          <div className="mb-3 text-center">
            <Button variant="ghost" className="min-h-9 py-1 text-xs" pending={loadingEarlier} onClick={() => void loadEarlier()}>
              Load earlier messages
            </Button>
          </div>
        ) : null}
        <ol role="log" aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2">
          {items.length === 0 ? <li className="py-10 text-center text-sm text-muted">No messages yet. Start the conversation with {otherClubName}.</li> : null}
          {items.map((m) => (
            <li key={m.id} className={`flex flex-col ${m.fromMe ? 'items-end' : 'items-start'}`}>
              {m.id === firstUnread ? (
                <p className="my-2 w-full border-t border-electric/50 pt-1 text-center text-xs font-semibold text-link" aria-hidden="true">
                  New
                </p>
              ) : null}
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.fromMe ? 'bg-primary text-on-primary' : 'border border-line bg-surface text-ink'}`}>
                <span className="sr-only">{m.fromMe ? 'You' : otherClubName}: </span>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              </div>
              <p className="mt-0.5 px-1 text-[11px] text-muted">
                {m.fromMe ? 'You' : otherClubName} · <time dateTime={m.createdAt}>{formatMessageTime(m.createdAt)}</time>
              </p>
            </li>
          ))}
        </ol>
      </div>

      {canSend ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick replies">
            {QUICK_REPLIES.map((q) => (
              <button
                key={q}
                type="button"
                className="min-h-8 rounded-full border border-line-strong bg-surface px-3 text-xs font-semibold text-ink hover:bg-surface-2"
                onClick={() => {
                  setDraft((d) => (d.trim() ? `${d.trimEnd()} ${q}` : q));
                  composer.current?.focus();
                }}
              >
                {q}
              </button>
            ))}
          </div>
          <label htmlFor={composerId} className="sr-only">
            Message to {otherClubName}
          </label>
          <div className="flex items-end gap-2">
            <textarea
              ref={composer}
              id={composerId}
              rows={2}
              value={draft}
              maxLength={MESSAGE_MAX}
              placeholder={`Message ${otherClubName}`}
              className="rp-input min-h-11 flex-1 resize-y"
              aria-describedby={countId}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button type="submit" pending={sending} disabled={!draft.trim()} aria-label="Send message">
              <Icon name="send" />
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
          <p id={countId} className="text-xs text-muted">
            Enter to send, Shift+Enter for a new line.{remaining < 200 ? ` ${remaining} characters left.` : ''} Keep messages club-to-club: no personal or medical details about boxers.
          </p>
          {error ? (
            <Alert tone="danger" live>
              {error}
            </Alert>
          ) : null}
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted">{otherClubName} is not currently active on RingPortal, so new messages cannot be sent.</p>
      )}
    </div>
  );
}
