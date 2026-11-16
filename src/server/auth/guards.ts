import 'server-only';
import type { NextRequest } from 'next/server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError } from '@/server/http';
import {
  cookieName,
  readSessionToken,
  resolveAdminSession,
  resolveClubSession,
  type AdminSession,
  type ClubSession,
} from './session';

// API route guards ----------------------------------------------------------

/** Authenticated club session for an API request. Club identity always comes from here, never from the request body. */
export async function requireClubApi(req: NextRequest): Promise<ClubSession> {
  const session = await resolveClubSession(readSessionToken(req, 'club'));
  if (!session) throw new ApiError('unauthenticated', 'Sign in to continue');
  return session;
}

/** As requireClubApi, and the club must be approved (verified matchmaking features). */
export async function requireApprovedClubApi(req: NextRequest): Promise<ClubSession> {
  const session = await requireClubApi(req);
  if (session.clubStatus !== 'approved') throw new ApiError('forbidden', 'Your club must be approved to use this feature');
  return session;
}

export async function requireAdminApi(req: NextRequest, opts: { ownerOnly?: boolean } = {}): Promise<AdminSession> {
  const session = await resolveAdminSession(readSessionToken(req, 'admin'));
  if (!session) throw new ApiError('unauthenticated', 'Sign in to continue');
  if (opts.ownerOnly && session.role !== 'owner') throw new ApiError('forbidden', 'Platform owner permission required');
  return session;
}

// Server component / page guards -------------------------------------------

async function tokenFromCookies(kind: 'club' | 'admin'): Promise<string | undefined> {
  const jar = await cookies();
  const value = jar.get(cookieName(kind))?.value;
  return value && value.length >= 32 && value.length <= 128 ? value : undefined;
}

export async function getClubSession(): Promise<ClubSession | null> {
  return resolveClubSession(await tokenFromCookies('club'));
}

export async function requireClubPage(): Promise<ClubSession> {
  const session = await getClubSession();
  if (!session) {
    const next = safeNext((await headers()).get('x-rp-path'), '/dashboard');
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return session;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  return resolveAdminSession(await tokenFromCookies('admin'));
}

export async function requireAdminPage(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  return session;
}

/** Only allow same-site relative redirects after login. */
export function safeNext(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
