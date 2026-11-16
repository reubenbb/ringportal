import 'server-only';
import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

// OWASP Password Storage Cheat Sheet minimum for Argon2id.
const OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(256, 'Use 256 characters or fewer')
  .refine((p) => p.trim().length >= 12, 'Use at least 12 non-space characters');

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, candidate: string): Promise<boolean> {
  try {
    return await verify(stored, candidate);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Spend equivalent time when the account does not exist, so login timing does not reveal registered emails. */
export async function burnPasswordCheck(candidate: string): Promise<void> {
  dummy ??= hashPassword('ringportal-timing-equaliser-not-a-real-password');
  await verifyPassword(await dummy, candidate);
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email('Enter a valid email address'))
  .transform(normaliseEmail);
