'use client';
import { useCallback, useState } from 'react';

export type ApiFailure = { code: string; message: string; fields?: Record<string, string> };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/** JSON request to our own API. Same-origin, so the browser sends Origin for the server's CSRF check. */
export async function api<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: { code: 'network', message: 'Could not reach RingPortal. Check your connection and try again.' } };
  }
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (res.ok) return { ok: true, data: payload as T };
  const err = (payload as { error?: ApiFailure } | null)?.error;
  if (res.status === 429) return { ok: false, error: { code: 'rate_limited', message: err?.message ?? 'Too many attempts. Try again later.' } };
  return { ok: false, error: err ?? { code: 'internal', message: 'Something went wrong. Please try again.' } };
}

/** Form submission state: pending, field errors and a form-level message. */
export function useSubmit<T>() {
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = useCallback(async (method: string, path: string, body?: unknown): Promise<T | null> => {
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    const result = await api<T>(method, path, body);
    setPending(false);
    if (result.ok) return result.data;
    setFieldErrors(result.error.fields ?? {});
    setFormError(result.error.fields ? (result.error.message ?? null) : result.error.message);
    return null;
  }, []);

  const clearField = useCallback((name: string) => {
    setFieldErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  return { pending, fieldErrors, formError, submit, clearField, setFormError };
}
