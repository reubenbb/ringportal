import 'server-only';
import { env } from '@/server/env';

export type MailMessage = { to: string; subject: string; text: string };
export type MailResult = { delivered: boolean };

/**
 * Outbound email. No production provider is configured yet (pending product
 * owner decision), so production uses 'disabled', which sends nothing and logs
 * no message content. 'console' is for local development and tests only.
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const transport = env().MAIL_TRANSPORT;
  if (transport === 'console') {
    outbox.push(message);
    if (process.env.NODE_ENV === 'development') {
      console.info(`[mail:console] to=${message.to} subject="${message.subject}"\n${message.text}`);
    }
    return { delivered: true };
  }
  console.warn('[mail] transport disabled; message not sent', { subject: message.subject });
  return { delivered: false };
}

/** In-memory record of console-transport mail, for tests. */
export const outbox: MailMessage[] = [];
