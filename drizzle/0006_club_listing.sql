-- Approved RingPortal clubs as seen by other approved clubs and admins.
-- Club rows are otherwise visible only to their own club (RLS), so this
-- exposes only public listing fields: no contacts, affiliation numbers or reasons.
CREATE OR REPLACE FUNCTION approved_club_listing()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  governing_body text,
  is_demo boolean,
  active_boxers integer
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.name, c.slug, g.name, c.is_demo,
         (SELECT count(*)::integer FROM boxers b WHERE b.club_id = c.id AND b.archived_at IS NULL)
  FROM clubs c
  JOIN governing_bodies g ON g.id = c.governing_body_id
  WHERE c.status = 'approved'
    AND (
      app_context() = 'admin'
      OR (app_context() = 'club' AND EXISTS (
            SELECT 1 FROM clubs me WHERE me.id = app_club_id() AND me.status = 'approved'))
    )
  ORDER BY c.name, c.id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION approved_club_listing() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION approved_club_listing() TO ringportal_app;
