-- Club logos: a club manages its own logo; approved clubs can see the logos of other
-- approved clubs (the same audience as club profiles); admins can see all.

CREATE OR REPLACE FUNCTION club_is_approved(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM clubs WHERE id = target AND status = 'approved') $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION club_is_approved(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION club_is_approved(uuid) TO ringportal_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON club_logos TO ringportal_app;
--> statement-breakpoint
ALTER TABLE club_logos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE club_logos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY club_logos_admin_read ON club_logos FOR SELECT USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY club_logos_own ON club_logos FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint
CREATE POLICY club_logos_approved_read ON club_logos FOR SELECT
  USING (app_context() = 'club' AND app_club_approved() AND club_is_approved(club_id));
--> statement-breakpoint
CREATE TRIGGER club_logos_touch_updated_at BEFORE UPDATE ON club_logos FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
