import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/server/env';

/** URL-safe, high-entropy token for cookies, reset links and MFA challenges. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 digests; 256-bit random input makes salting unnecessary. */
export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Keyed pseudonym for IPs and rate-limit subjects so raw identifiers are never persisted. */
export function pseudonymise(value: string): string {
  const key = Buffer.from(env().LOG_HASH_KEY, 'base64');
  return createHmac('sha256', key).update(value, 'utf8').digest('base64url').slice(0, 32);
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

const VERSION = 'v1';

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, base64url parts. */
export function encryptSecret(plaintext: string, aad: string): string {
  const key = Buffer.from(env().MFA_ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(payload: string, aad: string): string {
  const [version, iv, tag, ct] = payload.split('.');
  if (version !== VERSION || !iv || !tag || !ct) throw new Error('Unsupported secret format');
  const key = Buffer.from(env().MFA_ENCRYPTION_KEY, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
