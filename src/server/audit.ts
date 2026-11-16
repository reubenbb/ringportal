import 'server-only';
import type { Tx } from '@/server/db/client';
import { auditLog } from '@/server/db/schema';

export type AuditEntry = {
  actorType: 'club_user' | 'platform_user' | 'system' | 'anonymous';
  actorId?: string | null;
  clubId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  /** Never put passwords, tokens, codes, medical or junior personal data in metadata. */
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
};

export async function audit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorType: e.actorType,
    actorId: e.actorId ?? null,
    clubId: e.clubId ?? null,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    reason: e.reason ?? null,
    metadata: e.metadata ?? {},
    ipHash: e.ipHash ?? null,
  });
}
