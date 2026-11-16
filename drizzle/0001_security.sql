-- RingPortal security foundation.
-- The application connects as a LOGIN role that is a member of ringportal_app.
-- ringportal_app has no BYPASSRLS, owns nothing and cannot run DDL.
-- Request context is set per transaction by the server (set_config(..., true)):
--   app.context  = 'club' | 'admin' | 'auth'
--   app.club_id  = uuid of the authenticated club (club context only)
-- Row-level security is defence in depth behind server-side authorisation.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ringportal_app') THEN
    CREATE ROLE ringportal_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_context() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('app.context', true), ''), 'none') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_club_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.club_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER clubs_touch_updated_at BEFORE UPDATE ON clubs
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_audit_log_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app_audit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app_audit_log_immutable();
--> statement-breakpoint

-- Reference data -------------------------------------------------------------
INSERT INTO governing_bodies (id, code, name, country) VALUES
  (1, 'ENGLAND_BOXING', 'England Boxing', 'England'),
  (2, 'BOXING_SCOTLAND', 'Boxing Scotland', 'Scotland'),
  (3, 'WELSH_BOXING', 'Welsh Boxing', 'Wales'),
  (4, 'IRISH_AMATEUR', 'Irish amateur boxing', 'Ireland')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- Grants ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO ringportal_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_context(), app_club_id() TO ringportal_app;
--> statement-breakpoint
GRANT SELECT ON governing_bodies TO ringportal_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON clubs TO ringportal_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON club_users, platform_users TO ringportal_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON club_sessions, platform_sessions, platform_mfa_challenges,
  platform_recovery_codes, password_reset_tokens, rate_limits TO ringportal_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO ringportal_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_log_id_seq TO ringportal_app;
--> statement-breakpoint

-- Row-level security ---------------------------------------------------------
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE clubs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clubs_platform ON clubs FOR ALL
  USING (app_context() IN ('admin', 'auth')) WITH CHECK (app_context() IN ('admin', 'auth'));
--> statement-breakpoint
CREATE POLICY clubs_own_read ON clubs FOR SELECT
  USING (app_context() = 'club' AND id = app_club_id());
--> statement-breakpoint

ALTER TABLE club_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE club_users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY club_users_platform ON club_users FOR ALL
  USING (app_context() IN ('admin', 'auth')) WITH CHECK (app_context() IN ('admin', 'auth'));
--> statement-breakpoint
CREATE POLICY club_users_own ON club_users FOR SELECT
  USING (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint
CREATE POLICY club_users_own_update ON club_users FOR UPDATE
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint

ALTER TABLE club_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE club_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY club_sessions_platform ON club_sessions FOR ALL
  USING (app_context() IN ('admin', 'auth')) WITH CHECK (app_context() IN ('admin', 'auth'));
--> statement-breakpoint
CREATE POLICY club_sessions_own ON club_sessions FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint

ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_users_platform ON platform_users FOR ALL
  USING (app_context() IN ('admin', 'auth')) WITH CHECK (app_context() IN ('admin', 'auth'));
--> statement-breakpoint

ALTER TABLE platform_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_sessions_platform ON platform_sessions FOR ALL
  USING (app_context() IN ('admin', 'auth')) WITH CHECK (app_context() IN ('admin', 'auth'));
--> statement-breakpoint

ALTER TABLE platform_mfa_challenges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_mfa_challenges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_mfa_challenges_auth ON platform_mfa_challenges FOR ALL
  USING (app_context() IN ('admin', 'auth')) WITH CHECK (app_context() IN ('admin', 'auth'));
--> statement-breakpoint

ALTER TABLE platform_recovery_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_recovery_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_recovery_codes_platform ON platform_recovery_codes FOR ALL
  USING (app_context() IN ('admin', 'auth')) WITH CHECK (app_context() IN ('admin', 'auth'));
--> statement-breakpoint

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY password_reset_tokens_auth ON password_reset_tokens FOR ALL
  USING (app_context() = 'auth') WITH CHECK (app_context() = 'auth');
--> statement-breakpoint

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (
    app_context() IN ('admin', 'auth')
    OR (app_context() = 'club' AND club_id = app_club_id())
  );
--> statement-breakpoint
CREATE POLICY audit_log_admin_read ON audit_log FOR SELECT
  USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY audit_log_club_read ON audit_log FOR SELECT
  USING (app_context() = 'club' AND club_id = app_club_id());
