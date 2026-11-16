CREATE TYPE "public"."address_flag" AS ENUM('missing', 'differs_from_map');--> statement-breakpoint
CREATE TYPE "public"."address_status" AS ENUM('unverified', 'verified');--> statement-breakpoint
CREATE TYPE "public"."directory_claim_status" AS ENUM('unclaimed', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."directory_source" AS ENUM('england_boxing_directory');--> statement-breakpoint
CREATE TABLE "directory_clubs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "directory_source" NOT NULL,
	"source_ref" text NOT NULL,
	"source_url" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"governing_body_id" smallint NOT NULL,
	"region" text,
	"membership_type" text,
	"listed_status" text,
	"address" text,
	"postcode" text,
	"address_status" "address_status" DEFAULT 'unverified' NOT NULL,
	"address_flag" "address_flag",
	"address_verified_at" timestamp with time zone,
	"address_verified_by" uuid,
	"website" text,
	"social_reference" text,
	"claim_status" "directory_claim_status" DEFAULT 'unclaimed' NOT NULL,
	"club_id" uuid,
	"first_imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_import_run_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "directory_clubs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "directory_clubs_club_id_unique" UNIQUE("club_id"),
	CONSTRAINT "directory_clubs_verified_consistent" CHECK (("directory_clubs"."address_status" = 'verified') = ("directory_clubs"."address_verified_at" is not null and "directory_clubs"."address" is not null)),
	CONSTRAINT "directory_clubs_claim_consistent" CHECK (("directory_clubs"."claim_status" = 'claimed') = ("directory_clubs"."club_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "directory_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "directory_source" NOT NULL,
	"file_sha256" text NOT NULL,
	"rows_total" integer NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"address_conflicts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "directory_clubs" ADD CONSTRAINT "directory_clubs_governing_body_id_governing_bodies_id_fk" FOREIGN KEY ("governing_body_id") REFERENCES "public"."governing_bodies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_clubs" ADD CONSTRAINT "directory_clubs_address_verified_by_platform_users_id_fk" FOREIGN KEY ("address_verified_by") REFERENCES "public"."platform_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_clubs" ADD CONSTRAINT "directory_clubs_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "directory_clubs" ADD CONSTRAINT "directory_clubs_last_import_run_id_directory_import_runs_id_fk" FOREIGN KEY ("last_import_run_id") REFERENCES "public"."directory_import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "directory_clubs_source_ref_uq" ON "directory_clubs" USING btree ("source","source_ref");--> statement-breakpoint
CREATE INDEX "directory_clubs_name_idx" ON "directory_clubs" USING btree ("name");--> statement-breakpoint
CREATE INDEX "directory_clubs_region_idx" ON "directory_clubs" USING btree ("region");--> statement-breakpoint
CREATE INDEX "directory_clubs_postcode_idx" ON "directory_clubs" USING btree ("postcode");