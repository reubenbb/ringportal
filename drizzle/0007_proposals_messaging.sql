CREATE TYPE "public"."bout_type" AS ENUM('competitive', 'skills');--> statement-breakpoint
CREATE TYPE "public"."conversation_kind" AS ENUM('general', 'boxer', 'proposal');--> statement-breakpoint
CREATE TYPE "public"."proposal_event" AS ENUM('created', 'revised', 'accepted', 'confirmed', 'bout_confirmed', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('sent', 'negotiating', 'accepted_in_principle', 'awaiting_confirmation', 'confirmed', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "bout_proposal_confirmations" (
	"proposal_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"club_id" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bout_proposal_confirmations_proposal_id_version_club_id_pk" PRIMARY KEY("proposal_id","version","club_id")
);
--> statement-breakpoint
CREATE TABLE "bout_proposal_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"club_id" uuid NOT NULL,
	"actor_id" uuid,
	"event" "proposal_event" NOT NULL,
	"from_status" "proposal_status",
	"to_status" "proposal_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bout_proposal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version" smallint NOT NULL,
	"author_club_id" uuid NOT NULL,
	"proposed_date" date,
	"weight_kg" numeric(5, 2) NOT NULL,
	"bout_type" "bout_type" NOT NULL,
	"travel" text,
	"terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bout_proposal_versions_weight_range" CHECK ("bout_proposal_versions"."weight_kg" between 20 and 200),
	CONSTRAINT "bout_proposal_versions_text_len" CHECK (coalesce(char_length("bout_proposal_versions"."travel"), 0) <= 500 and coalesce(char_length("bout_proposal_versions"."terms"), 0) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "bout_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposing_club_id" uuid NOT NULL,
	"receiving_club_id" uuid NOT NULL,
	"proposing_boxer_id" uuid NOT NULL,
	"receiving_boxer_id" uuid NOT NULL,
	"status" "proposal_status" DEFAULT 'sent' NOT NULL,
	"current_version" smallint DEFAULT 1 NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bout_proposals_distinct_clubs" CHECK ("bout_proposals"."proposing_club_id" <> "bout_proposals"."receiving_club_id"),
	CONSTRAINT "bout_proposals_distinct_boxers" CHECK ("bout_proposals"."proposing_boxer_id" <> "bout_proposals"."receiving_boxer_id"),
	CONSTRAINT "bout_proposals_version_positive" CHECK ("bout_proposals"."current_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "conversation_club_state" (
	"conversation_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"last_read_message_id" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "conversation_club_state_conversation_id_club_id_pk" PRIMARY KEY("conversation_id","club_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_low_id" uuid NOT NULL,
	"club_high_id" uuid NOT NULL,
	"kind" "conversation_kind" NOT NULL,
	"boxer_id" uuid,
	"proposal_id" uuid,
	"started_by_club_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_ordered_pair" CHECK ("conversations"."club_low_id" < "conversations"."club_high_id"),
	CONSTRAINT "conversations_started_by_party" CHECK ("conversations"."started_by_club_id" in ("conversations"."club_low_id", "conversations"."club_high_id")),
	CONSTRAINT "conversations_kind_links" CHECK (("conversations"."kind" = 'general' and "conversations"."boxer_id" is null and "conversations"."proposal_id" is null)
        or ("conversations"."kind" = 'boxer' and "conversations"."boxer_id" is not null and "conversations"."proposal_id" is null)
        or ("conversations"."kind" = 'proposal' and "conversations"."proposal_id" is not null and "conversations"."boxer_id" is null))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_club_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_body_len" CHECK (char_length("messages"."body") between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "bout_proposal_confirmations" ADD CONSTRAINT "bout_proposal_confirmations_proposal_id_bout_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."bout_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposal_confirmations" ADD CONSTRAINT "bout_proposal_confirmations_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposal_confirmations" ADD CONSTRAINT "bout_proposal_confirmations_confirmed_by_club_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."club_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposal_events" ADD CONSTRAINT "bout_proposal_events_proposal_id_bout_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."bout_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposal_events" ADD CONSTRAINT "bout_proposal_events_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposal_events" ADD CONSTRAINT "bout_proposal_events_actor_id_club_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."club_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposal_versions" ADD CONSTRAINT "bout_proposal_versions_proposal_id_bout_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."bout_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposal_versions" ADD CONSTRAINT "bout_proposal_versions_author_club_id_clubs_id_fk" FOREIGN KEY ("author_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposals" ADD CONSTRAINT "bout_proposals_proposing_club_id_clubs_id_fk" FOREIGN KEY ("proposing_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposals" ADD CONSTRAINT "bout_proposals_receiving_club_id_clubs_id_fk" FOREIGN KEY ("receiving_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposals" ADD CONSTRAINT "bout_proposals_proposing_boxer_id_boxers_id_fk" FOREIGN KEY ("proposing_boxer_id") REFERENCES "public"."boxers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bout_proposals" ADD CONSTRAINT "bout_proposals_receiving_boxer_id_boxers_id_fk" FOREIGN KEY ("receiving_boxer_id") REFERENCES "public"."boxers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_club_state" ADD CONSTRAINT "conversation_club_state_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_club_state" ADD CONSTRAINT "conversation_club_state_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_club_low_id_clubs_id_fk" FOREIGN KEY ("club_low_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_club_high_id_clubs_id_fk" FOREIGN KEY ("club_high_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_boxer_id_boxers_id_fk" FOREIGN KEY ("boxer_id") REFERENCES "public"."boxers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_proposal_id_bout_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."bout_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_started_by_club_id_clubs_id_fk" FOREIGN KEY ("started_by_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_club_id_clubs_id_fk" FOREIGN KEY ("sender_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_club_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."club_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bout_proposal_events_proposal_idx" ON "bout_proposal_events" USING btree ("proposal_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "bout_proposal_versions_uq" ON "bout_proposal_versions" USING btree ("proposal_id","version");--> statement-breakpoint
CREATE INDEX "bout_proposals_proposing_idx" ON "bout_proposals" USING btree ("proposing_club_id","updated_at");--> statement-breakpoint
CREATE INDEX "bout_proposals_receiving_idx" ON "bout_proposals" USING btree ("receiving_club_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bout_proposals_open_pair_uq" ON "bout_proposals" USING btree (least("proposing_boxer_id", "receiving_boxer_id"),greatest("proposing_boxer_id", "receiving_boxer_id")) WHERE "bout_proposals"."status" in ('sent', 'negotiating', 'accepted_in_principle', 'awaiting_confirmation');--> statement-breakpoint
CREATE INDEX "conversations_low_idx" ON "conversations" USING btree ("club_low_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_high_idx" ON "conversations" USING btree ("club_high_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_general_uq" ON "conversations" USING btree ("club_low_id","club_high_id") WHERE "conversations"."kind" = 'general';--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_boxer_uq" ON "conversations" USING btree ("club_low_id","club_high_id","boxer_id") WHERE "conversations"."kind" = 'boxer';--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_proposal_uq" ON "conversations" USING btree ("proposal_id") WHERE "conversations"."kind" = 'proposal';--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","id");