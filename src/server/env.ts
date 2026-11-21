import 'server-only';
import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Least-privilege application role (member of ringportal_app). Never the owner role. */
    DATABASE_URL: z.url(),
    /** Public origin, e.g. https://ringportal.co.uk. Used for CSRF origin checks and email links. */
    APP_ORIGIN: z.url(),
    /** AES-256-GCM key for TOTP secrets at rest. */
    MFA_ENCRYPTION_KEY: base64Key32,
    /** HMAC key used to pseudonymise IP addresses and rate-limit subjects in logs. */
    LOG_HASH_KEY: base64Key32,
    /** 'resend' sends through Resend. 'console' prints mail to the server log (development/test only). 'disabled' sends nothing. */
    MAIL_TRANSPORT: z.enum(['resend', 'console', 'disabled']).default('disabled'),
    /** Resend API key (starts "re_"). Required when MAIL_TRANSPORT=resend. */
    RESEND_API_KEY: z.string().regex(/^re_[A-Za-z0-9_]{10,}$/, 'must be a Resend API key').optional(),
    /** Sender, e.g. "RingPortal <no-reply@mail.ringportal.co.uk>", on a domain verified in Resend. */
    MAIL_FROM: z.string().regex(/^[^<>\r\n]{0,80}<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$|^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/, 'must be an email address, optionally with a display name').optional(),
    /** Shared secret Vercel Cron sends as a bearer token. Scheduled jobs refuse to run without it. */
    CRON_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_TRANSPORT === 'resend') {
      if (!env.RESEND_API_KEY) ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'required when MAIL_TRANSPORT=resend' });
      if (!env.MAIL_FROM) ctx.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'required when MAIL_TRANSPORT=resend' });
    }
    if (env.NODE_ENV === 'production') {
      if (env.MAIL_TRANSPORT === 'console') {
        ctx.addIssue({ code: 'custom', path: ['MAIL_TRANSPORT'], message: 'console mail transport is not allowed in production' });
      }
      const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.APP_ORIGIN);
      if (!env.APP_ORIGIN.startsWith('https://') && !local) {
        ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'must be https in production (localhost allowed for local smoke tests)' });
      }
    }
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated lazily so `next build` does not require runtime secrets. */
export function env(): Env {
  if (cached) return cached;
  // On Vercel, default the public origin to the project's production URL (system variable).
  const source = { ...process.env };
  if (!source.APP_ORIGIN && source.VERCEL_PROJECT_PRODUCTION_URL) source.APP_ORIGIN = `https://${source.VERCEL_PROJECT_PRODUCTION_URL}`;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server environment: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Origins accepted for state-changing requests: APP_ORIGIN plus, on Vercel, the
 * platform-provided URLs of this exact deployment (set by Vercel, not by clients).
 */
export function allowedOrigins(): Set<string> {
  const set = new Set<string>([new URL(env().APP_ORIGIN).origin]);
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const host = process.env[key];
    if (host && /^[a-z0-9.-]+$/i.test(host)) set.add(`https://${host}`);
  }
  return set;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Test hook only. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}
