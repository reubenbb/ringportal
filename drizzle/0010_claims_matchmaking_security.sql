-- Club claims: created during registration (auth context), decided by administrators.
GRANT SELECT, INSERT, UPDATE ON club_claims TO ringportal_app;
--> statement-breakpoint
ALTER TABLE club_claims ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE club_claims FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY club_claims_admin ON club_claims FOR ALL
  USING (app_context() = 'admin') WITH CHECK (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY club_claims_register ON club_claims FOR INSERT
  WITH CHECK (app_context() = 'auth' AND status = 'pending' AND decided_by IS NULL);
--> statement-breakpoint
CREATE POLICY club_claims_own_read ON club_claims FOR SELECT
  USING (app_context() = 'club' AND club_id = app_club_id());
--> statement-breakpoint

-- Directory records that can still be claimed, for the public registration form.
-- Name, region and id only; no addresses or contact details.
CREATE OR REPLACE FUNCTION claimable_directory_clubs(q text, max_rows integer)
RETURNS TABLE (id uuid, name text, region text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.id, d.name, d.region
  FROM directory_clubs d
  WHERE app_context() = 'auth'
    AND char_length(trim(q)) >= 3
    AND d.claim_status = 'unclaimed'
    AND d.name ILIKE '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    AND NOT EXISTS (SELECT 1 FROM club_claims c WHERE c.directory_club_id = d.id AND c.status IN ('pending', 'approved'))
  ORDER BY d.name
  LIMIT least(greatest(max_rows, 1), 20)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claimable_directory_clubs(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION claimable_directory_clubs(text, integer) TO ringportal_app;
--> statement-breakpoint

-- Matchmaking candidates: active boxers of OTHER approved clubs, minimised exactly
-- like club_boxer_roster (no DOB, medical or notes; under-18 surnames shortened).
-- Only approved clubs may search. Filtering by sex, weight and age happens here so
-- that dates of birth never leave the database.
CREATE OR REPLACE FUNCTION match_candidates(
  p_sex boxer_sex,
  p_min_kg numeric,
  p_max_kg numeric,
  p_min_age integer,
  p_max_age integer,
  p_governing_body smallint,
  p_include_unavailable boolean
)
RETURNS TABLE (
  id uuid,
  club_id uuid,
  club_name text,
  club_slug text,
  club_is_demo boolean,
  governing_body text,
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
  availability boxer_availability
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (
    SELECT
      b.id, b.club_id, c.name, c.slug, c.is_demo, g.name,
      CASE WHEN date_part('year', age(current_date, p.date_of_birth)) < 18
           THEN b.first_name || ' ' || left(b.last_name, 1) || '.'
           ELSE b.first_name || ' ' || b.last_name END,
      b.sex,
      date_part('year', age(current_date, p.date_of_birth))::integer AS age_years,
      date_part('year', age(current_date, p.date_of_birth)) < 18,
      b.weight_kg, b.competitive_wins, b.competitive_losses, b.competitive_draws,
      (b.competitive_wins + b.competitive_losses + b.competitive_draws)::integer,
      b.skills_bouts, b.availability
    FROM boxers b
    JOIN boxer_private p ON p.boxer_id = b.id
    JOIN clubs c ON c.id = b.club_id
    JOIN governing_bodies g ON g.id = c.governing_body_id
    WHERE app_context() = 'club'
      AND EXISTS (SELECT 1 FROM clubs me WHERE me.id = app_club_id() AND me.status = 'approved')
      AND c.status = 'approved'
      AND b.club_id <> app_club_id()
      AND b.archived_at IS NULL
      AND b.sex = p_sex
      AND b.weight_kg BETWEEN p_min_kg AND p_max_kg
      AND (p_governing_body IS NULL OR c.governing_body_id = p_governing_body)
      AND (p_include_unavailable OR b.availability IN ('ready', 'provisionally_arranged'))
  ) s
  WHERE s.age_years BETWEEN p_min_age AND p_max_age
  ORDER BY s.weight_kg, s.id
  LIMIT 300
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION match_candidates(boxer_sex, numeric, numeric, integer, integer, smallint, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION match_candidates(boxer_sex, numeric, numeric, integer, integer, smallint, boolean) TO ringportal_app;
