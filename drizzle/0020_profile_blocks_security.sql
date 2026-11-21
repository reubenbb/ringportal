-- Club blocks, club-edited profiles.

-- True when the calling club and `other` have blocked each other in either direction.
-- SECURITY DEFINER so a club learns that it cannot contact another club without
-- being able to read the other club's block list.
CREATE OR REPLACE FUNCTION blocked_with(other uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT app_context() = 'club' AND EXISTS (
    SELECT 1 FROM club_blocks
    WHERE (blocker_club_id = app_club_id() AND blocked_club_id = other)
       OR (blocker_club_id = other AND blocked_club_id = app_club_id())) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION blocked_with(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION blocked_with(uuid) TO ringportal_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON club_blocks TO ringportal_app;
--> statement-breakpoint
ALTER TABLE club_blocks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE club_blocks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY club_blocks_admin_read ON club_blocks FOR SELECT USING (app_context() = 'admin');
--> statement-breakpoint
-- A club sees and manages only the blocks it created.
CREATE POLICY club_blocks_own ON club_blocks FOR ALL
  USING (app_context() = 'club' AND blocker_club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND blocker_club_id = app_club_id());
--> statement-breakpoint

-- Blocks are enforced in the database as well as the application.
DROP POLICY messages_insert ON messages;
--> statement-breakpoint
CREATE POLICY messages_insert ON messages FOR INSERT
  WITH CHECK (app_context() = 'club' AND sender_club_id = app_club_id()
    AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id
      AND NOT blocked_with(CASE WHEN c.club_low_id = app_club_id() THEN c.club_high_id ELSE c.club_low_id END)));
--> statement-breakpoint
DROP POLICY bout_proposals_insert ON bout_proposals;
--> statement-breakpoint
CREATE POLICY bout_proposals_insert ON bout_proposals FOR INSERT
  WITH CHECK (app_context() = 'club' AND proposing_club_id = app_club_id() AND NOT blocked_with(receiving_club_id));
--> statement-breakpoint
DROP POLICY sparring_offers_insert ON sparring_offers;
--> statement-breakpoint
CREATE POLICY sparring_offers_insert ON sparring_offers FOR INSERT
  WITH CHECK (app_context() = 'club' AND offering_club_id = app_club_id() AND app_club_approved() AND status = 'pending'
    AND NOT blocked_with(request_club_id)
    AND request_club_id = (SELECT r.club_id FROM sparring_requests r WHERE r.id = request_id AND r.status = 'open'));
--> statement-breakpoint

-- Matchmaking leaves out clubs blocked in either direction.
CREATE OR REPLACE FUNCTION match_candidates(
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
      AND NOT blocked_with(b.club_id)
      AND (p_include_unavailable OR b.availability IN ('ready', 'provisionally_arranged'))
  ) s
  WHERE s.age_years BETWEEN p_min_age AND p_max_age
  ORDER BY s.weight_kg, s.id
  LIMIT 300
$$;
--> statement-breakpoint

-- A club edits only its own profile fields (never name, status, affiliation or region).
CREATE OR REPLACE FUNCTION update_club_profile(p_about text, p_website text, p_contact_email text, p_training_venue text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF app_context() <> 'club' OR app_club_id() IS NULL THEN
    RAISE EXCEPTION 'club context required';
  END IF;
  UPDATE clubs SET about = p_about, website = p_website, contact_email = p_contact_email, training_venue = p_training_venue
  WHERE id = app_club_id();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION update_club_profile(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION update_club_profile(text, text, text, text) TO ringportal_app;
--> statement-breakpoint

-- Profile shown to other approved clubs and admins (and the club itself).
CREATE OR REPLACE FUNCTION club_public_profile(target uuid)
RETURNS TABLE (id uuid, region text, about text, website text, contact_email text, training_venue text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.region, c.about, c.website, c.contact_email, c.training_venue
  FROM clubs c
  WHERE c.id = target
    AND (app_context() = 'admin'
      OR (app_context() = 'club' AND (c.id = app_club_id()
        OR (c.status = 'approved' AND EXISTS (SELECT 1 FROM clubs me WHERE me.id = app_club_id() AND me.status = 'approved')))))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION club_public_profile(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION club_public_profile(uuid) TO ringportal_app;
