-- When a boxer's weight was last entered, so clubs can tell a current weight from an old one.
ALTER TABLE "boxers" ADD COLUMN "weight_recorded_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
-- Best available estimate for existing boxers: the last time the row changed.
UPDATE "boxers" SET "weight_recorded_at" = "updated_at";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION boxers_weight_recorded() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.weight_kg IS DISTINCT FROM OLD.weight_kg THEN
    NEW.weight_recorded_at := now();
  ELSE
    -- The timestamp only moves with the weight: it cannot be set directly.
    NEW.weight_recorded_at := OLD.weight_recorded_at;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION boxers_weight_recorded() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER boxers_weight_recorded BEFORE INSERT OR UPDATE ON "boxers" FOR EACH ROW EXECUTE FUNCTION boxers_weight_recorded();
