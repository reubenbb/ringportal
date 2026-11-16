CREATE TYPE "public"."boxer_availability" AS ENUM('ready', 'injured_medical', 'provisionally_arranged', 'confirmed', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."boxer_sex" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TABLE "boxer_availability_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"boxer_id" uuid NOT NULL,
	"club_id" uuid NOT NULL,
	"from_status" "boxer_availability",
	"to_status" "boxer_availability" NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boxer_private" (
	"boxer_id" uuid PRIMARY KEY NOT NULL,
	"club_id" uuid NOT NULL,
	"date_of_birth" date NOT NULL,
	"medical_status" text,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boxer_private_dob_range" CHECK ("boxer_private"."date_of_birth" >= date '1940-01-01')
);
--> statement-breakpoint
CREATE TABLE "boxers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"club_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"sex" "boxer_sex" NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"competitive_wins" smallint DEFAULT 0 NOT NULL,
	"competitive_losses" smallint DEFAULT 0 NOT NULL,
	"competitive_draws" smallint DEFAULT 0 NOT NULL,
	"skills_bouts" smallint DEFAULT 0 NOT NULL,
	"availability" "boxer_availability" DEFAULT 'ready' NOT NULL,
	"availability_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boxers_name_len" CHECK (char_length("boxers"."first_name") between 1 and 60 and char_length("boxers"."last_name") between 1 and 60),
	CONSTRAINT "boxers_weight_range" CHECK ("boxers"."weight_kg" between 20 and 200),
	CONSTRAINT "boxers_record_non_negative" CHECK ("boxers"."competitive_wins" >= 0 and "boxers"."competitive_losses" >= 0 and "boxers"."competitive_draws" >= 0 and "boxers"."skills_bouts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "boxer_availability_history" ADD CONSTRAINT "boxer_availability_history_boxer_id_boxers_id_fk" FOREIGN KEY ("boxer_id") REFERENCES "public"."boxers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxer_availability_history" ADD CONSTRAINT "boxer_availability_history_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxer_availability_history" ADD CONSTRAINT "boxer_availability_history_changed_by_club_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."club_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxer_private" ADD CONSTRAINT "boxer_private_boxer_id_boxers_id_fk" FOREIGN KEY ("boxer_id") REFERENCES "public"."boxers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxer_private" ADD CONSTRAINT "boxer_private_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxers" ADD CONSTRAINT "boxers_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boxer_availability_history_boxer_idx" ON "boxer_availability_history" USING btree ("boxer_id","changed_at");--> statement-breakpoint
CREATE INDEX "boxer_private_club_idx" ON "boxer_private" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "boxers_club_idx" ON "boxers" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "boxers_matching_idx" ON "boxers" USING btree ("sex","weight_kg");