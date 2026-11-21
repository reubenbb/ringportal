import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMail } from '@/server/mail';
import { env, resetEnvCacheForTests } from '@/server/env';

const KEY = 're_test_0123456789abcdef';
function useResend(extra: Record<string, string | undefined> = {}) {
  vi.stubEnv('MAIL_TRANSPORT', 'resend');
  vi.stubEnv('RESEND_API_KEY', KEY);
  vi.stubEnv('MAIL_FROM', 'RingPortal <no-reply@mail.example.test>');
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v as string);
  resetEnvCacheForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetEnvCacheForTests();
});

const msg = { to: 'coach@club.example', subject: 'Reset your RingPortal password', text: 'secret-link-123' };

describe('mail transport: resend', () => {
  it('posts the message to Resend with the API key and sender', async () => {
    useResend();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendMail(msg)).toEqual({ delivered: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body)).toEqual({ from: 'RingPortal <no-reply@mail.example.test>', to: ['coach@club.example'], subject: msg.subject, text: msg.text });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reports failure without logging the recipient, body or key', async () => {
    useResend();
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(JSON.stringify(a)));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: 'validation_error', message: 'coach@club.example bad' }), { status: 422 })));
    expect(await sendMail(msg)).toEqual({ delivered: false });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })));
    expect(await sendMail(msg)).toEqual({ delivered: false });
    const all = logs.join('\n');
    expect(all).toContain('validation_error');
    expect(all).toContain('TimeoutError');
    for (const secret of ['coach@club.example', 'secret-link-123', KEY]) expect(all).not.toContain(secret);
  });

  it('requires a key and sender, and rejects malformed values', () => {
    vi.stubEnv('MAIL_TRANSPORT', 'resend');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('MAIL_FROM', '');
    resetEnvCacheForTests();
    expect(() => env()).toThrow(/RESEND_API_KEY|MAIL_FROM/);
    useResend({ MAIL_FROM: 'Evil\r\nBcc: x@y.z <a@b.c>' });
    expect(() => env()).toThrow(/MAIL_FROM/);
    useResend({ RESEND_API_KEY: 'sk_live_nope' });
    expect(() => env()).toThrow(/RESEND_API_KEY/);
  });
});
