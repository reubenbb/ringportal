-- Clubs already linked to a directory record take that record's region.
UPDATE clubs c SET region = d.region FROM directory_clubs d WHERE d.club_id = c.id AND c.region IS NULL AND d.region IS NOT NULL;
--> statement-breakpoint
DROP FUNCTION match_candidates(boxer_sex, numeric, numeric, integer, integer, smallint, boolean);
--> statement-breakpoint
CREATE FUNCTION match_candidates(
  p_sex boxer_sex,
  p_min_kg numeric,
  p_max_kg numeric,
  p_min_age integer,
  p_max_age integer,
  p_governing_body smallint,
  p_include_unavailable boolean,
  p_region text
)
RETURNS TABLE (
  id uuid,
  club_id uuid,
  club_name text,
  club_slug text,
  club_is_demo boolean,
  club_region text,
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
      b.id, b.club_id, c.name, c.slug, c.is_demo, c.region, g.name,
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
      AND (p_region IS NULL OR c.region = p_region)
      AND (p_include_unavailable OR b.availability IN ('ready', 'provisionally_arranged'))
  ) s
  WHERE s.age_years BETWEEN p_min_age AND p_max_age
  ORDER BY s.weight_kg, s.id
  LIMIT 300
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION match_candidates(boxer_sex, numeric, numeric, integer, integer, smallint, boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION match_candidates(boxer_sex, numeric, numeric, integer, integer, smallint, boolean, text) TO ringportal_app;
