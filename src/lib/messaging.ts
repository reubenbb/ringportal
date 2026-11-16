export const MESSAGE_MAX = 2000;

/** One-tap replies. Plain club-to-club wording; nothing personal or medical. */
export const QUICK_REPLIES = [
  'Thanks, we’ll check and come back to you.',
  'That works for us.',
  'That date doesn’t work for us. Could you suggest another?',
  'Can you confirm the weight?',
  'Our boxer isn’t available at the moment.',
  'Happy to discuss. What suits you?',
] as const;

export type ConversationKind = 'general' | 'boxer' | 'proposal';

export const KIND_LABEL: Record<ConversationKind, string> = {
  general: 'General',
  boxer: 'About a boxer',
  proposal: 'Bout proposal',
};

export function formatMessageTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const opts: Intl.DateTimeFormatOptions = sameDay
    ? { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }
    : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' };
  return new Intl.DateTimeFormat('en-GB', opts).format(d);
}
