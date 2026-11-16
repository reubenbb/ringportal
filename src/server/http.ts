import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { allowedOrigins } from '@/server/env';
import { pseudonymise } from '@/server/auth/crypto';

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'csrf_rejected'
  | 'internal';

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  csrf_rejected: 403,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function errorResponse(err: ApiError): NextResponse {
  const res = NextResponse.json(
    { error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } },
    { status: STATUS[err.code] },
  );
  if (err.retryAfterSeconds) res.headers.set('Retry-After', String(err.retryAfterSeconds));
  return res;
}

/**
 * CSRF defence for state-changing requests (OWASP "verify origin with standard headers"):
 * Origin must be one of allowedOrigins(), or, when absent, Sec-Fetch-Site must be same-origin.
 * Combined with SameSite=Lax cookies and a JSON-only body (forcing a CORS preflight).
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin');
  if (origin) {
    if (!allowedOrigins().has(origin)) throw new ApiError('csrf_rejected', 'Cross-site request rejected');
    return;
  }
  if (req.headers.get('sec-fetch-site') !== 'same-origin') {
    throw new ApiError('csrf_rejected', 'Cross-site request rejected');
  }
}

export async function readJson<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError('bad_request', 'Expected application/json');
  }
  const raw = await req.text();
  if (raw.length > 32_768) throw new ApiError('bad_request', 'Request body too large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiError('bad_request', 'Malformed JSON');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new ApiError('validation_failed', 'Check the highlighted fields', fields);
  }
  return parsed.data;
}

/**
 * Client IP as reported by the platform edge. On Vercel, x-forwarded-for is set
 * by the platform and the first entry is the client. Only ever stored pseudonymised.
 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  const first = fwd?.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || 'unknown';
}

export function ipHash(req: NextRequest): string {
  return pseudonymise(`ip:${clientIp(req)}`);
}

export function userAgent(req: NextRequest): string | null {
  return req.headers.get('user-agent')?.slice(0, 300) ?? null;
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<NextResponse>;

/** Wraps a route handler: CSRF check on unsafe methods and consistent error structure. */
export function route<C = unknown>(handler: Handler<C>, opts: { csrf?: boolean } = {}): Handler<C> {
  return async (req, ctx) => {
    try {
      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (unsafe && opts.csrf !== false) assertSameOrigin(req);
      const res = await handler(req, ctx);
      res.headers.set('Cache-Control', 'no-store');
      return res;
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err);
      console.error('[api] unhandled error', {
        path: req.nextUrl.pathname,
        method: req.method,
        name: err instanceof Error ? err.name : 'unknown',
        message: err instanceof Error ? err.message : 'unknown',
      });
      return errorResponse(new ApiError('internal', 'Something went wrong. Please try again.'));
    }
  };
}

export function ok(body: unknown = { ok: true }, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, init);
}
