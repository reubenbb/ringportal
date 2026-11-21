CREATE TABLE "club_blocks" (
	"blocker_club_id" uuid NOT NULL,
	"blocked_club_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_blocks_blocker_club_id_blocked_club_id_pk" PRIMARY KEY("blocker_club_id","blocked_club_id"),
	CONSTRAINT "club_blocks_not_self" CHECK ("club_blocks"."blocker_club_id" <> "club_blocks"."blocked_club_id")
);
--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "clubs" ADD COLUMN "training_venue" text;--> statement-breakpoint
ALTER TABLE "club_blocks" ADD CONSTRAINT "club_blocks_blocker_club_id_clubs_id_fk" FOREIGN KEY ("blocker_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_blocks" ADD CONSTRAINT "club_blocks_blocked_club_id_clubs_id_fk" FOREIGN KEY ("blocked_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_blocks_blocked_idx" ON "club_blocks" USING btree ("blocked_club_id");