CREATE TABLE "club_logos" (
	"club_id" uuid PRIMARY KEY NOT NULL,
	"image" "bytea" NOT NULL,
	"width" smallint NOT NULL,
	"height" smallint NOT NULL,
	"sha256" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_logos_size" CHECK (octet_length("club_logos"."image") <= 204800),
	CONSTRAINT "club_logos_dims" CHECK ("club_logos"."width" between 1 and 512 and "club_logos"."height" between 1 and 512)
);
--> statement-breakpoint
ALTER TABLE "club_logos" ADD CONSTRAINT "club_logos_club_id_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs"("id") ON DELETE restrict ON UPDATE no action;