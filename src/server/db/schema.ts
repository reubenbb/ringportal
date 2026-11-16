import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Raw bytes; used for token hashes so they are never stored as recoverable text. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const clubStatus = pgEnum('club_status', [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'suspended',
  'reverification_required',
]);

export const accountStatus = pgEnum('account_status', ['active', 'disabled']);
export const clubUserRole = pgEnum('club_user_role', ['club_admin']);
export const platformRole = pgEnum('platform_role', ['owner', 'admin']);
export const resetSubject = pgEnum('reset_subject', ['club_user', 'platform_user']);
export const actorType = pgEnum('actor_type', ['club_user', 'platform_user', 'system', 'anonymous']);

export const governingBodies = pgTable('governing_bodies', {
  id: smallint('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  country: text('country').notNull(),
});

export const clubs = pgTable(
  'clubs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    governingBodyId: smallint('governing_body_id')
      .notNull()
      .references(() => governingBodies.id),
    affiliationNumber: text('affiliation_number'),
    affiliationExpiresOn: date('affiliation_expires_on', { mode: 'string' }),
    status: clubStatus('status').notNull().default('draft'),
    statusReason: text('status_reason'),
    statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
    /** True only for clearly separated demo/seed data. Never shown as verified. */
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('clubs_affiliation_uq')
      .on(t.governingBodyId, t.affiliationNumber)
      .where(sql`${t.affiliationNumber} is not null`),
    index('clubs_status_idx').on(t.status),
    check('clubs_name_len', sql`char_length(${t.name}) between 2 and 160`),
    check('clubs_slug_fmt', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/**
 * Login identities for a club. The current product uses one shared login per
 * club; the table already supports several so individual staff accounts can be
 * added later without a redesign.
 */
export const clubUsers = pgTable(
  'club_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: clubUserRole('role').notNull().default('club_admin'),
    status: accountStatus('status').notNull().default('active'),
    passwordChangedAt: ts('password_changed_at').notNull().defaultNow(),
    lastLoginAt: ts('last_login_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('club_users_club_idx').on(t.clubId),
    check('club_users_email_lower', sql`${t.email} = lower(${t.email})`),
  ],
);

export const clubSessions = pgTable(
  'club_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubUserId: uuid('club_user_id')
      .notNull()
      .references(() => clubUsers.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
  },
  (t) => [index('club_sessions_user_idx').on(t.clubUserId), index('club_sessions_club_idx').on(t.clubId)],
);

export const platformUsers = pgTable(
  'platform_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: platformRole('role').notNull().default('admin'),
    status: accountStatus('status').notNull().default('active'),
    /** AES-256-GCM ciphertext of the TOTP secret; null until enrolment is confirmed. */
    mfaSecretEnc: text('mfa_secret_enc'),
    /** Pending secret during enrolment or rotation; promoted on confirmation. */
    mfaPendingSecretEnc: text('mfa_pending_secret_enc'),
    mfaEnabledAt: ts('mfa_enabled_at'),
    /** Last accepted TOTP time-step, to stop the same code being replayed. */
    mfaLastStep: integer('mfa_last_step'),
    passwordChangedAt: ts('password_changed_at').notNull().defaultNow(),
    lastLoginAt: ts('last_login_at'),
    createdAt: createdAt(),
  },
  (t) => [check('platform_users_email_lower', sql`${t.email} = lower(${t.email})`)],
);

export const platformRecoveryCodes = pgTable(
  'platform_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platformUserId: uuid('platform_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    codeHash: bytea('code_hash').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('platform_recovery_codes_uq').on(t.platformUserId, t.codeHash)],
);

/** Short-lived step between password check and second factor. */
export const platformMfaChallenges = pgTable('platform_mfa_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  platformUserId: uuid('platform_user_id')
    .notNull()
    .references(() => platformUsers.id, { onDelete: 'cascade' }),
  tokenHash: bytea('token_hash').notNull().unique(),
  attempts: smallint('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  createdAt: createdAt(),
});

export const platformSessions = pgTable(
  'platform_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platformUserId: uuid('platform_user_id')
      .notNull()
      .references(() => platformUsers.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
  },
  (t) => [index('platform_sessions_user_idx').on(t.platformUserId)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectType: resetSubject('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('password_reset_subject_idx').on(t.subjectType, t.subjectId)],
);

export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: text('bucket').notNull(),
    windowStart: ts('window_start').notNull(),
    hits: integer('hits').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowStart] }), index('rate_limits_window_idx').on(t.windowStart)],
);

// ---------------------------------------------------------------------------
// Club directory: pre-populated profiles for clubs that may not have registered.
// A directory profile is never a club account: it cannot sign in or act as a club.

export const directorySource = pgEnum('directory_source', ['england_boxing_directory']);
export const addressStatus = pgEnum('address_status', ['unverified', 'verified']);
export const addressFlag = pgEnum('address_flag', ['missing', 'differs_from_map']);
export const directoryClaimStatus = pgEnum('directory_claim_status', ['unclaimed', 'claimed']);

export const directoryImportRuns = pgTable('directory_import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: directorySource('source').notNull(),
  fileSha256: text('file_sha256').notNull(),
  rowsTotal: integer('rows_total').notNull(),
  inserted: integer('inserted').notNull().default(0),
  updated: integer('updated').notNull().default(0),
  unchanged: integer('unchanged').notNull().default(0),
  skipped: integer('skipped').notNull().default(0),
  addressConflicts: integer('address_conflicts').notNull().default(0),
  startedAt: ts('started_at').notNull().defaultNow(),
  finishedAt: ts('finished_at'),
});

export const directoryClubs = pgTable(
  'directory_clubs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Attribution: every imported record is attributed to its source directory. */
    source: directorySource('source').notNull(),
    /** Identifier in the source directory (England Boxing official id). */
    sourceRef: text('source_ref').notNull(),
    sourceUrl: text('source_url').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    governingBodyId: smallint('governing_body_id')
      .notNull()
      .references(() => governingBodies.id),
    region: text('region'),
    membershipType: text('membership_type'),
    listedStatus: text('listed_status'),
    address: text('address'),
    postcode: text('postcode'),
    /** Every imported address starts unverified; only an administrator can mark it verified. */
    addressStatus: addressStatus('address_status').notNull().default('unverified'),
    addressFlag: addressFlag('address_flag'),
    addressVerifiedAt: ts('address_verified_at'),
    addressVerifiedBy: uuid('address_verified_by').references(() => platformUsers.id),
    website: text('website'),
    socialReference: text('social_reference'),
    claimStatus: directoryClaimStatus('claim_status').notNull().default('unclaimed'),
    clubId: uuid('club_id')
      .unique()
      .references(() => clubs.id, { onDelete: 'set null' }),
    firstImportedAt: ts('first_imported_at').notNull().defaultNow(),
    lastImportedAt: ts('last_imported_at').notNull().defaultNow(),
    lastImportRunId: uuid('last_import_run_id').references(() => directoryImportRuns.id),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('directory_clubs_source_ref_uq').on(t.source, t.sourceRef),
    index('directory_clubs_name_idx').on(t.name),
    index('directory_clubs_region_idx').on(t.region),
    index('directory_clubs_postcode_idx').on(t.postcode),
    check(
      'directory_clubs_verified_consistent',
      sql`(${t.addressStatus} = 'verified') = (${t.addressVerifiedAt} is not null and ${t.address} is not null)`,
    ),
    check('directory_clubs_claim_consistent', sql`(${t.claimStatus} = 'claimed') = (${t.clubId} is not null)`),
  ],
);

// ---------------------------------------------------------------------------
// Boxers. Owned by their club. Matchmaking-safe fields live in `boxers`;
// date of birth, medical/eligibility status and internal notes live in
// `boxer_private`, which only the owning club (and admins) can read.
// Other clubs only ever see a minimised projection (club_boxer_roster()).

export const boxerSex = pgEnum('boxer_sex', ['male', 'female']);
export const boxerAvailability = pgEnum('boxer_availability', ['ready', 'injured_medical', 'provisionally_arranged', 'confirmed', 'inactive']);

export const boxers = pgTable(
  'boxers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    sex: boxerSex('sex').notNull(),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    competitiveWins: smallint('competitive_wins').notNull().default(0),
    competitiveLosses: smallint('competitive_losses').notNull().default(0),
    competitiveDraws: smallint('competitive_draws').notNull().default(0),
    /** Separate from the competitive record and never added to it. */
    skillsBouts: smallint('skills_bouts').notNull().default(0),
    availability: boxerAvailability('availability').notNull().default('ready'),
    availabilityChangedAt: ts('availability_changed_at').notNull().defaultNow(),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('boxers_club_idx').on(t.clubId),
    index('boxers_matching_idx').on(t.sex, t.weightKg),
    check('boxers_name_len', sql`char_length(${t.firstName}) between 1 and 60 and char_length(${t.lastName}) between 1 and 60`),
    check('boxers_weight_range', sql`${t.weightKg} between 20 and 200`),
    check(
      'boxers_record_non_negative',
      sql`${t.competitiveWins} >= 0 and ${t.competitiveLosses} >= 0 and ${t.competitiveDraws} >= 0 and ${t.skillsBouts} >= 0`,
    ),
  ],
);

export const boxerPrivate = pgTable(
  'boxer_private',
  {
    boxerId: uuid('boxer_id')
      .primaryKey()
      .references(() => boxers.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    dateOfBirth: date('date_of_birth', { mode: 'string' }).notNull(),
    /** Eligibility/medical status as recorded by the club. Never shown to other clubs. */
    medicalStatus: text('medical_status'),
    notes: text('notes'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('boxer_private_club_idx').on(t.clubId),
    check('boxer_private_dob_range', sql`${t.dateOfBirth} >= date '1940-01-01'`),
  ],
);

export const boxerAvailabilityHistory = pgTable(
  'boxer_availability_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    boxerId: uuid('boxer_id')
      .notNull()
      .references(() => boxers.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    fromStatus: boxerAvailability('from_status'),
    toStatus: boxerAvailability('to_status').notNull(),
    changedBy: uuid('changed_by').references(() => clubUsers.id, { onDelete: 'set null' }),
    changedAt: ts('changed_at').notNull().defaultNow(),
  },
  (t) => [index('boxer_availability_history_boxer_idx').on(t.boxerId, t.changedAt)],
);

/** Append-only. The application role may insert and read, never update or delete. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    clubId: uuid('club_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    reason: text('reason'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ipHash: text('ip_hash'),
  },
  (t) => [
    index('audit_log_club_idx').on(t.clubId, t.occurredAt),
    index('audit_log_actor_idx').on(t.actorId, t.occurredAt),
    index('audit_log_action_idx').on(t.action, t.occurredAt),
  ],
);

// Bout proposals -------------------------------------------------------------
// A proposal is between two approved clubs about one boxer from each.
// Terms live in immutable, numbered versions. Acceptance and each club's final
// confirmation apply to one version only, so any new version resets them.

export const boutType = pgEnum('bout_type', ['competitive', 'skills']);
export const proposalStatus = pgEnum('proposal_status', [
  'sent',
  'negotiating',
  'accepted_in_principle',
  'awaiting_confirmation',
  'confirmed',
  'declined',
  'withdrawn',
]);
export const proposalEvent = pgEnum('proposal_event', ['created', 'revised', 'accepted', 'confirmed', 'bout_confirmed', 'declined', 'withdrawn']);

export const boutProposals = pgTable(
  'bout_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposingClubId: uuid('proposing_club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    receivingClubId: uuid('receiving_club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    proposingBoxerId: uuid('proposing_boxer_id')
      .notNull()
      .references(() => boxers.id, { onDelete: 'restrict' }),
    receivingBoxerId: uuid('receiving_boxer_id')
      .notNull()
      .references(() => boxers.id, { onDelete: 'restrict' }),
    status: proposalStatus('status').notNull().default('sent'),
    currentVersion: smallint('current_version').notNull().default(1),
    statusChangedAt: ts('status_changed_at').notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('bout_proposals_proposing_idx').on(t.proposingClubId, t.updatedAt),
    index('bout_proposals_receiving_idx').on(t.receivingClubId, t.updatedAt),
    // One open negotiation per pair of boxers (either direction). Confirmed, declined and withdrawn do not block a new one.
    uniqueIndex('bout_proposals_open_pair_uq')
      .on(sql`least(${t.proposingBoxerId}, ${t.receivingBoxerId})`, sql`greatest(${t.proposingBoxerId}, ${t.receivingBoxerId})`)
      .where(sql`${t.status} in ('sent', 'negotiating', 'accepted_in_principle', 'awaiting_confirmation')`),
    check('bout_proposals_distinct_clubs', sql`${t.proposingClubId} <> ${t.receivingClubId}`),
    check('bout_proposals_distinct_boxers', sql`${t.proposingBoxerId} <> ${t.receivingBoxerId}`),
    check('bout_proposals_version_positive', sql`${t.currentVersion} >= 1`),
  ],
);

export const boutProposalVersions = pgTable(
  'bout_proposal_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => boutProposals.id, { onDelete: 'restrict' }),
    version: smallint('version').notNull(),
    authorClubId: uuid('author_club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    proposedDate: date('proposed_date', { mode: 'string' }),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    boutType: boutType('bout_type').notNull(),
    travel: text('travel'),
    terms: text('terms'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bout_proposal_versions_uq').on(t.proposalId, t.version),
    check('bout_proposal_versions_weight_range', sql`${t.weightKg} between 20 and 200`),
    check('bout_proposal_versions_text_len', sql`coalesce(char_length(${t.travel}), 0) <= 500 and coalesce(char_length(${t.terms}), 0) <= 1000`),
  ],
);

export const boutProposalConfirmations = pgTable(
  'bout_proposal_confirmations',
  {
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => boutProposals.id, { onDelete: 'restrict' }),
    version: smallint('version').notNull(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    confirmedBy: uuid('confirmed_by').references(() => clubUsers.id, { onDelete: 'set null' }),
    confirmedAt: ts('confirmed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.version, t.clubId] })],
);

export const boutProposalEvents = pgTable(
  'bout_proposal_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => boutProposals.id, { onDelete: 'restrict' }),
    version: smallint('version').notNull(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id').references(() => clubUsers.id, { onDelete: 'set null' }),
    event: proposalEvent('event').notNull(),
    fromStatus: proposalStatus('from_status'),
    toStatus: proposalStatus('to_status').notNull(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [index('bout_proposal_events_proposal_idx').on(t.proposalId, t.id)],
);

// Club-to-club messaging ------------------------------------------------------
// A conversation is always between exactly two clubs (stored low/high so a pair
// is unique). It is general, about one boxer, or attached to one proposal.

export const conversationKind = pgEnum('conversation_kind', ['general', 'boxer', 'proposal']);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubLowId: uuid('club_low_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    clubHighId: uuid('club_high_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    kind: conversationKind('kind').notNull(),
    boxerId: uuid('boxer_id').references(() => boxers.id, { onDelete: 'restrict' }),
    proposalId: uuid('proposal_id').references(() => boutProposals.id, { onDelete: 'restrict' }),
    startedByClubId: uuid('started_by_club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    lastMessageAt: ts('last_message_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('conversations_low_idx').on(t.clubLowId, t.lastMessageAt),
    index('conversations_high_idx').on(t.clubHighId, t.lastMessageAt),
    uniqueIndex('conversations_general_uq').on(t.clubLowId, t.clubHighId).where(sql`${t.kind} = 'general'`),
    uniqueIndex('conversations_boxer_uq').on(t.clubLowId, t.clubHighId, t.boxerId).where(sql`${t.kind} = 'boxer'`),
    uniqueIndex('conversations_proposal_uq').on(t.proposalId).where(sql`${t.kind} = 'proposal'`),
    check('conversations_ordered_pair', sql`${t.clubLowId} < ${t.clubHighId}`),
    check('conversations_started_by_party', sql`${t.startedByClubId} in (${t.clubLowId}, ${t.clubHighId})`),
    check(
      'conversations_kind_links',
      sql`(${t.kind} = 'general' and ${t.boxerId} is null and ${t.proposalId} is null)
        or (${t.kind} = 'boxer' and ${t.boxerId} is not null and ${t.proposalId} is null)
        or (${t.kind} = 'proposal' and ${t.proposalId} is not null and ${t.boxerId} is null)`,
    ),
  ],
);

/** Each club's own read position and archive flag. A club never sees the other club's row. */
export const conversationClubState = pgTable(
  'conversation_club_state',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    lastReadMessageId: bigint('last_read_message_id', { mode: 'number' }).notNull().default(0),
    archivedAt: ts('archived_at'),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.clubId] })],
);

/** Immutable. The application role may insert and read, never update or delete. */
export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    senderClubId: uuid('sender_club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),
    senderUserId: uuid('sender_user_id').references(() => clubUsers.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('messages_conversation_idx').on(t.conversationId, t.id),
    check('messages_body_len', sql`char_length(${t.body}) between 1 and 2000`),
  ],
);
