CREATE TYPE "public"."request_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."show_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sparring_offer_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."sparring_request_status" AS ENUM('open', 'arranged', 'closed');--> statement-breakpoint
CREATE TABLE "opponent_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"show_id" uuid,
	"boxer_id" uuid,
	"sex" "boxer_sex" NOT NULL,
	"min_age" smallint NOT NULL,
	"max_age" smallint NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"bout_type" "bout_type" NOT NULL,
	"experience" text,
	"needed_on" date,
	"location" text,
	"requirements" text,
	"status" "request_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opponent_requests_age" CHECK ("opponent_requests"."min_age" between 8 and 80 and "opponent_requests"."max_age" between 8 and 80 and "opponent_requests"."min_age" <= "opponent_requests"."max_age"),
	CONSTRAINT "opponent_requests_weight" CHECK ("opponent_requests"."weight_kg" between 20 and 200)
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"venue" text NOT NULL,
	"postcode" text NOT NULL,
	"contact_route" text,
	"requirements" text,
	"info" text,
	"listed_publicly" boolean DEFAULT true NOT NULL,
	"status" "show_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shows_text_len" CHECK (char_length("shows"."name") between 3 and 120 and char_length("shows"."venue") between 2 and 160 and char_length("shows"."postcode") between 2 and 10)
);
--> statement-breakpoint
CREATE TABLE "sparring_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"attended" boolean NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sparring_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"request_club_id" uuid NOT NULL,
	"offering_club_id" uuid NOT NULL,
	"partner_boxer_id" uuid NOT NULL,
	"note" text,
	"status" "sparring_offer_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sparring_offers_distinct_clubs" CHECK ("sparring_offers"."request_club_id" <> "sparring_offers"."offering_club_id")
);
--> statement-breakpoint
CREATE TABLE "sparring_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"boxer_id" uuid NOT NULL,
	"availability_note" text,
	"location" text,
	"notes" text,
	"status" "sparring_request_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opponent_requests" ADD CONSTRAINT "opponent_requests_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opponent_requests" ADD CONSTRAINT "opponent_requests_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opponent_requests" ADD CONSTRAINT "opponent_requests_boxer_id_boxers_id_fk" FOREIGN KEY ("boxer_id") REFERENCES "public"."boxers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparring_attendance" ADD CONSTRAINT "sparring_attendance_offer_id_sparring_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."sparring_offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparring_attendance" ADD CONSTRAINT "sparring_attendance_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparring_offers" ADD CONSTRAINT "sparring_offers_request_id_sparring_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sparring_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparring_offers" ADD CONSTRAINT "sparring_offers_request_club_id_clubs_id_fk" FOREIGN KEY ("request_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparring_offers" ADD CONSTRAINT "sparring_offers_offering_club_id_clubs_id_fk" FOREIGN KEY ("offering_club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparring_offers" ADD CONSTRAINT "sparring_offers_partner_boxer_id_boxers_id_fk" FOREIGN KEY ("partner_boxer_id") REFERENCES "public"."boxers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparring_requests" ADD CONSTRAINT "sparring_requests_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparring_requests" ADD CONSTRAINT "sparring_requests_boxer_id_boxers_id_fk" FOREIGN KEY ("boxer_id") REFERENCES "public"."boxers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opponent_requests_club_idx" ON "opponent_requests" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "opponent_requests_open_idx" ON "opponent_requests" USING btree ("status","sex","weight_kg");--> statement-breakpoint
CREATE INDEX "shows_club_idx" ON "shows" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "shows_starts_idx" ON "shows" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sparring_attendance_uq" ON "sparring_attendance" USING btree ("offer_id","club_id","session_date");--> statement-breakpoint
CREATE INDEX "sparring_offers_request_idx" ON "sparring_offers" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "sparring_offers_offering_idx" ON "sparring_offers" USING btree ("offering_club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sparring_offers_live_partner_uq" ON "sparring_offers" USING btree ("request_id","partner_boxer_id") WHERE "sparring_offers"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "sparring_offers_one_approved_uq" ON "sparring_offers" USING btree ("request_id") WHERE "sparring_offers"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "sparring_requests_club_idx" ON "sparring_requests" USING btree ("club_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sparring_requests_open_boxer_uq" ON "sparring_requests" USING btree ("boxer_id") WHERE "sparring_requests"."status" = 'open';