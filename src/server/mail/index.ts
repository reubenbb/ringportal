import 'server-only';
import { env } from '@/server/env';

export type MailMessage = { to: string; subject: string; text: string };
export type MailResult = { delivered: boolean };

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/**
 * Outbound email.
 * - 'resend': sends through Resend's HTTPS API (key and sender from env).
 * - 'console': development and tests only; kept in memory and, in development, printed.
 * - 'disabled': sends nothing.
 * Logs never include the recipient address or message body; a failure logs only
 * the HTTP status and Resend's error name.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const e = env();
  if (e.MAIL_TRANSPORT === 'console') {
    outbox.push(message);
    if (process.env.NODE_ENV === 'development') {
      console.info(`[mail:console] to=${message.to} subject="${message.subject}"\n${message.text}`);
    }
    return { delivered: true };
  }
  if (e.MAIL_TRANSPORT === 'resend') return sendViaResend(message, e.RESEND_API_KEY!, e.MAIL_FROM!);
  console.warn('[mail] transport disabled; message not sent', { subject: message.subject });
  return { delivered: false };
}

async function sendViaResend(message: MailMessage, apiKey: string, from: string): Promise<MailResult> {
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.ok) return { delivered: true };
    let name = 'unknown';
    try {
      name = String(((await res.json()) as { name?: unknown }).name ?? 'unknown').slice(0, 60);
    } catch {
      /* non-JSON error body */
    }
    console.error('[mail] resend rejected message', { status: res.status, error: name, subject: message.subject });
    return { delivered: false };
  } catch (err) {
    console.error('[mail] resend request failed', { error: err instanceof Error ? err.name : 'unknown', subject: message.subject });
    return { delivered: false };
  }
}

/** In-memory record of console-transport mail, for tests. */
export const outbox: MailMessage[] = [];
