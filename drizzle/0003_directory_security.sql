-- Club directory access. Directory profiles are reference data for verified
-- clubs and administrators; they never grant sign-in or club permissions.
-- Public (logged-out) views are not served from these tables directly.

CREATE TRIGGER directory_clubs_touch_updated_at BEFORE UPDATE ON directory_clubs
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON directory_clubs, directory_import_runs TO ringportal_app;
--> statement-breakpoint
ALTER TABLE directory_clubs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE directory_clubs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY directory_clubs_admin ON directory_clubs FOR ALL
  USING (app_context() = 'admin') WITH CHECK (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY directory_clubs_read ON directory_clubs FOR SELECT
  USING (app_context() IN ('club', 'auth'));
--> statement-breakpoint
ALTER TABLE directory_import_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE directory_import_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY directory_import_runs_admin ON directory_import_runs FOR ALL
  USING (app_context() = 'admin') WITH CHECK (app_context() = 'admin');
