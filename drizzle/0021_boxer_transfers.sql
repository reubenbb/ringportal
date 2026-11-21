CREATE TYPE "public"."boxer_transfer_status" AS ENUM('pending', 'approved', 'declined', 'cancelled');--> statement-breakpoint
CREATE TABLE "boxer_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"boxer_id" uuid NOT NULL,
	"from_club_id" uuid NOT NULL,
	"to_club_id" uuid NOT NULL,
	"status" "boxer_transfer_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boxer_transfers_distinct_clubs" CHECK ("boxer_transfers"."from_club_id" <> "boxer_transfers"."to_club_id"),
	CONSTRAINT "boxer_transfers_note_len" CHECK (coalesce(char_length("boxer_transfers"."note"), 0) <= 500)
);
--> statement-breakpoint
ALTER TABLE "boxer_transfers" ADD CONSTRAINT "boxer_transfers_boxer_id_boxers_id_fk" FOREIGN KEY ("boxer_id") REFERENCES "public"."boxers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxer_transfers" ADD CONSTRAINT "boxer_transfers_from_club_id_clubs_id_fk" FOREIGN KEY ("from_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxer_transfers" ADD CONSTRAINT "boxer_transfers_to_club_id_clubs_id_fk" FOREIGN KEY ("to_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxer_transfers" ADD CONSTRAINT "boxer_transfers_requested_by_club_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."club_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxer_transfers" ADD CONSTRAINT "boxer_transfers_decided_by_club_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."club_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boxer_transfers_from_idx" ON "boxer_transfers" USING btree ("from_club_id","created_at");--> statement-breakpoint
CREATE INDEX "boxer_transfers_to_idx" ON "boxer_transfers" USING btree ("to_club_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "boxer_transfers_pending_uq" ON "boxer_transfers" USING btree ("boxer_id") WHERE "boxer_transfers"."status" = 'pending';