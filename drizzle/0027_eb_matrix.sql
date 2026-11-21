-- England Boxing Rule Book 26.3, 2026 Club Boxing Matrix: categories are set by birth year (2.1.1),
-- except Minors, who must have had their 10th birthday (2.3.1). Under-10s cannot box, skills bout or spar.
-- Offsets from the season year: Minor = 10th birthday reached and born season-11 or season-10,
-- Schools = season-14..season-12, Junior = season-16..season-15, Youth = season-18..season-17,
-- Senior = season-40..season-19. Earlier births are outside the matrix.
CREATE OR REPLACE FUNCTION eb_category(p_dob date, p_on date)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_dob + interval '10 years' > p_on THEN 'too_young'
    WHEN extract(year FROM p_on)::int - extract(year FROM p_dob)::int <= 11 THEN 'minor'
    WHEN extract(year FROM p_on)::int - extract(year FROM p_dob)::int <= 14 THEN 'schools'
    WHEN extract(year FROM p_on)::int - extract(year FROM p_dob)::int <= 16 THEN 'junior'
    WHEN extract(year FROM p_on)::int - extract(year FROM p_dob)::int <= 18 THEN 'youth'
    WHEN extract(year FROM p_on)::int - extract(year FROM p_dob)::int <= 40 THEN 'senior'
    ELSE 'outside'
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION eb_category(date, date) FROM PUBLIC;
--> statement-breakpoint
-- What the matrix needs about a pairing, without revealing either date of birth: each boxer's category,
-- the age gap as a band (under 12 months, under 24 months, 24 months or more) and whether each is of
-- skills-bout age (10th birthday to the day before the 16th, Annex C2). The own boxer must belong to the
-- caller's club; other boxers must be visible to it under the same rules as boxer_cards.
CREATE OR REPLACE FUNCTION eb_pair_facts(p_own uuid, p_others uuid[])
RETURNS TABLE (boxer_id uuid, own_category text, category text, gap_band text, own_skills_age boolean, skills_age boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Europe/London')::date AS d),
  own AS (
    SELECT p.date_of_birth AS dob
    FROM boxers b JOIN boxer_private p ON p.boxer_id = b.id
    WHERE b.id = p_own
      AND (app_context() = 'admin' OR (app_context() = 'club' AND b.club_id = app_club_id()))
  )
  SELECT
    o.id,
    eb_category(own.dob, today.d),
    eb_category(p.date_of_birth, today.d),
    CASE
      WHEN own.dob + interval '12 months' > p.date_of_birth AND p.date_of_birth + interval '12 months' > own.dob THEN 'lt12'
      WHEN own.dob + interval '24 months' > p.date_of_birth AND p.date_of_birth + interval '24 months' > own.dob THEN 'lt24'
      ELSE 'ge24'
    END,
    today.d >= own.dob + interval '10 years' AND today.d < own.dob + interval '16 years',
    today.d >= p.date_of_birth + interval '10 years' AND today.d < p.date_of_birth + interval '16 years'
  FROM own, today, boxer_cards(p_others) o
  JOIN boxer_private p ON p.boxer_id = o.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION eb_pair_facts(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION eb_pair_facts(uuid, uuid[]) TO ringportal_app;
