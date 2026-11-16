-- Reports: a club may report a conversation it is party to and see its own reports;
-- administrators manage all reports.
GRANT SELECT, INSERT, UPDATE ON reports TO ringportal_app;
--> statement-breakpoint
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY reports_admin ON reports FOR ALL
  USING (app_context() = 'admin') WITH CHECK (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY reports_own_read ON reports FOR SELECT
  USING (app_context() = 'club' AND reporter_club_id = app_club_id());
--> statement-breakpoint
CREATE POLICY reports_insert ON reports FOR INSERT
  WITH CHECK (app_context() = 'club' AND reporter_club_id = app_club_id() AND status = 'open' AND resolved_by IS NULL
    AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id));
