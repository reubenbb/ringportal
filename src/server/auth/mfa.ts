import 'server-only';
import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import type { Tx } from '@/server/db/client';
import { platformRecoveryCodes, platformUsers } from '@/server/db/schema';
import { decryptSecret, encryptSecret, sha256 } from './crypto';

const PERIOD = 30;
const ISSUER = 'RingPortal';

function totp(secretBase32: string, label: string): TOTP {
  return new TOTP({ issuer: ISSUER, label, algorithm: 'SHA1', digits: 6, period: PERIOD, secret: Secret.fromBase32(secretBase32) });
}

const aad = (platformUserId: string) => `platform_user:${platformUserId}:totp`;

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function sealTotpSecret(platformUserId: string, secretBase32: string): string {
  return encryptSecret(secretBase32, aad(platformUserId));
}

export function openTotpSecret(platformUserId: string, sealed: string): string {
  return decryptSecret(sealed, aad(platformUserId));
}

export async function enrolmentPayload(email: string, secretBase32: string): Promise<{ uri: string; qrSvg: string; secret: string }> {
  const uri = totp(secretBase32, email).toString();
  const qrSvg = await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return { uri, qrSvg, secret: secretBase32 };
}

/**
 * Validates a 6-digit code (±1 step for clock drift) and returns its time-step,
 * or null. Callers must reject steps <= the last accepted step (replay protection).
 */
export function matchTotp(secretBase32: string, code: string, at = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp(secretBase32, 'verify').validate({ token: code, timestamp: at, window: 1 });
  if (delta === null) return null;
  return Math.floor(at / 1000 / PERIOD) + delta;
}

/** Test helper and enrolment tooling. */
export function generateTotp(secretBase32: string, at = Date.now()): string {
  return totp(secretBase32, 'gen').generate({ timestamp: at });
}

/**
 * Verifies the user's current TOTP and records the step so the same code cannot be reused.
 * Uses a conditional update so two concurrent requests cannot both consume one code.
 */
export async function verifyAndConsumeTotp(tx: Tx, platformUserId: string, code: string): Promise<boolean> {
  const [user] = await tx
    .select({ sealed: platformUsers.mfaSecretEnc, lastStep: platformUsers.mfaLastStep })
    .from(platformUsers)
    .where(eq(platformUsers.id, platformUserId))
    .for('update');
  if (!user?.sealed) return false;
  const step = matchTotp(openTotpSecret(platformUserId, user.sealed), code);
  if (step === null || (user.lastStep !== null && step <= user.lastStep)) return false;
  await tx.update(platformUsers).set({ mfaLastStep: step }).where(eq(platformUsers.id, platformUserId));
  return true;
}

// Recovery codes -------------------------------------------------------------

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function recoveryCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

export function normaliseRecoveryCode(input: string): string {
  const c = input.toLowerCase().replace(/[^a-z0-9]/g, '');
  return c.length === 12 ? `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}` : '';
}

/** Replaces all recovery codes; returns the plaintext codes exactly once. */
export async function issueRecoveryCodes(tx: Tx, platformUserId: string, count = 10): Promise<string[]> {
  const codes = Array.from({ length: count }, recoveryCode);
  await tx.delete(platformRecoveryCodes).where(eq(platformRecoveryCodes.platformUserId, platformUserId));
  await tx.insert(platformRecoveryCodes).values(codes.map((c) => ({ platformUserId, codeHash: sha256(c) })));
  return codes;
}

export async function consumeRecoveryCode(tx: Tx, platformUserId: string, input: string): Promise<boolean> {
  const code = normaliseRecoveryCode(input);
  if (!code) return false;
  const rows = await tx
    .update(platformRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(platformRecoveryCodes.platformUserId, platformUserId),
        eq(platformRecoveryCodes.codeHash, sha256(code)),
        isNull(platformRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: platformRecoveryCodes.id });
  return rows.length === 1;
}

export async function remainingRecoveryCodes(tx: Tx, platformUserId: string): Promise<number> {
  const rows = await tx
    .select({ id: platformRecoveryCodes.id })
    .from(platformRecoveryCodes)
    .where(and(eq(platformRecoveryCodes.platformUserId, platformUserId), isNull(platformRecoveryCodes.usedAt)));
  return rows.length;
}
