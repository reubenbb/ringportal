CREATE TYPE "public"."account_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('club_user', 'platform_user', 'system', 'anonymous');--> statement-breakpoint
CREATE TYPE "public"."club_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'suspended', 'reverification_required');--> statement-breakpoint
CREATE TYPE "public"."club_user_role" AS ENUM('club_admin');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('owner', 'admin');--> statement-breakpoint
CREATE TYPE "public"."reset_subject" AS ENUM('club_user', 'platform_user');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"club_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_hash" text
);
--> statement-breakpoint
CREATE TABLE "club_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_user_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_hash" text,
	CONSTRAINT "club_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "club_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "club_user_role" DEFAULT 'club_admin' NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_users_email_unique" UNIQUE("email"),
	CONSTRAINT "club_users_email_lower" CHECK ("club_users"."email" = lower("club_users"."email"))
);
--> statement-breakpoint
CREATE TABLE "clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"governing_body_id" smallint NOT NULL,
	"affiliation_number" text,
	"affiliation_expires_on" date,
	"status" "club_status" DEFAULT 'draft' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clubs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "clubs_name_len" CHECK (char_length("clubs"."name") between 2 and 160),
	CONSTRAINT "clubs_slug_fmt" CHECK ("clubs"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "governing_bodies" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	CONSTRAINT "governing_bodies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "reset_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_mfa_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_mfa_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_hash" text,
	CONSTRAINT "platform_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "platform_role" DEFAULT 'admin' NOT NULL,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"mfa_secret_enc" text,
	"mfa_pending_secret_enc" text,
	"mfa_enabled_at" timestamp with time zone,
	"mfa_last_step" integer,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_email_unique" UNIQUE("email"),
	CONSTRAINT "platform_users_email_lower" CHECK ("platform_users"."email" = lower("platform_users"."email"))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_bucket_window_start_pk" PRIMARY KEY("bucket","window_start")
);
--> statement-breakpoint
ALTER TABLE "club_sessions" ADD CONSTRAINT "club_sessions_club_user_id_club_users_id_fk" FOREIGN KEY ("club_user_id") REFERENCES "public"."club_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_sessions" ADD CONSTRAINT "club_sessions_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_users" ADD CONSTRAINT "club_users_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clubs" ADD CONSTRAINT "clubs_governing_body_id_governing_bodies_id_fk" FOREIGN KEY ("governing_body_id") REFERENCES "public"."governing_bodies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_mfa_challenges" ADD CONSTRAINT "platform_mfa_challenges_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_recovery_codes" ADD CONSTRAINT "platform_recovery_codes_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_club_idx" ON "audit_log" USING btree ("club_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "club_sessions_user_idx" ON "club_sessions" USING btree ("club_user_id");--> statement-breakpoint
CREATE INDEX "club_sessions_club_idx" ON "club_sessions" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "club_users_club_idx" ON "club_users" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_affiliation_uq" ON "clubs" USING btree ("governing_body_id","affiliation_number") WHERE "clubs"."affiliation_number" is not null;--> statement-breakpoint
CREATE INDEX "clubs_status_idx" ON "clubs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "password_reset_subject_idx" ON "password_reset_tokens" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_recovery_codes_uq" ON "platform_recovery_codes" USING btree ("platform_user_id","code_hash");--> statement-breakpoint
CREATE INDEX "platform_sessions_user_idx" ON "platform_sessions" USING btree ("platform_user_id");--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");