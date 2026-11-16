ALTER TABLE "clubs" ADD COLUMN "region" text;--> statement-breakpoint
CREATE INDEX "clubs_region_idx" ON "clubs" USING btree ("region");