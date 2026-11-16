-- Boxer data access.
-- * boxers / boxer_private / boxer_availability_history: owning club (and admins) only.
-- * Other approved clubs see a club's roster ONLY through club_boxer_roster(),
--   which returns minimised fields: no date of birth, no medical status, no notes,
--   and junior (under-18) names reduced to first name + surname initial.

CREATE TRIGGER boxers_touch_updated_at BEFORE UPDATE ON boxers
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER boxer_private_touch_updated_at BEFORE UPDATE ON boxer_private
  FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON boxers, boxer_private TO ringportal_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON boxer_availability_history TO ringportal_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE boxer_availability_history_id_seq TO ringportal_app;
--> statement-breakpoint

ALTER TABLE boxers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE boxers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY boxers_admin ON boxers FOR ALL
  USING (app_context() = 'admin') WITH CHECK (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY boxers_own_club ON boxers FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint

ALTER TABLE boxer_private ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE boxer_private FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY boxer_private_admin ON boxer_private FOR ALL
  USING (app_context() = 'admin') WITH CHECK (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY boxer_private_own_club ON boxer_private FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint

ALTER TABLE boxer_availability_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE boxer_availability_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY boxer_availability_history_admin ON boxer_availability_history FOR SELECT
  USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY boxer_availability_history_own_read ON boxer_availability_history FOR SELECT
  USING (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint
CREATE POLICY boxer_availability_history_own_insert ON boxer_availability_history FOR INSERT
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint

-- Minimised roster of one approved club, for approved clubs and admins.
-- SECURITY DEFINER so it can read DOB to compute age without exposing it.
CREATE OR REPLACE FUNCTION club_boxer_roster(target_club uuid)
RETURNS TABLE (
  id uuid,
  display_name text,
  sex boxer_sex,
  age_years integer,
  is_junior boolean,
  weight_kg numeric,
  competitive_wins smallint,
  competitive_losses smallint,
  competitive_draws smallint,
  total_bouts integer,
  skills_bouts smallint,
  availability boxer_availability,
  availability_changed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    b.id,
    CASE WHEN date_part('year', age(current_date, p.date_of_birth)) < 18
         THEN b.first_name || ' ' || left(b.last_name, 1) || '.'
         ELSE b.first_name || ' ' || b.last_name END,
    b.sex,
    date_part('year', age(current_date, p.date_of_birth))::integer,
    date_part('year', age(current_date, p.date_of_birth)) < 18,
    b.weight_kg,
    b.competitive_wins,
    b.competitive_losses,
    b.competitive_draws,
    (b.competitive_wins + b.competitive_losses + b.competitive_draws)::integer,
    b.skills_bouts,
    b.availability,
    b.availability_changed_at
  FROM boxers b
  JOIN boxer_private p ON p.boxer_id = b.id
  JOIN clubs c ON c.id = b.club_id
  WHERE b.club_id = target_club
    AND b.archived_at IS NULL
    AND c.status = 'approved'
    AND (
      app_context() = 'admin'
      OR (app_context() = 'club' AND EXISTS (
            SELECT 1 FROM clubs me WHERE me.id = app_club_id() AND me.status = 'approved'))
    )
  ORDER BY b.last_name, b.first_name, b.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION club_boxer_roster(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION club_boxer_roster(uuid) TO ringportal_app;
