CREATE TYPE "public"."club_claim_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "club_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"directory_club_id" uuid NOT NULL,
	"status" "club_claim_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "club_claims" ADD CONSTRAINT "club_claims_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_claims" ADD CONSTRAINT "club_claims_directory_club_id_directory_clubs_id_fk" FOREIGN KEY ("directory_club_id") REFERENCES "public"."directory_clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_claims" ADD CONSTRAINT "club_claims_decided_by_platform_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_claims_club_idx" ON "club_claims" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "club_claims_directory_live_uq" ON "club_claims" USING btree ("directory_club_id") WHERE "club_claims"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "club_claims_club_live_uq" ON "club_claims" USING btree ("club_id") WHERE "club_claims"."status" in ('pending', 'approved');