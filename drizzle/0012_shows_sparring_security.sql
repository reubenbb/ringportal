-- Shows, opponent requests and individual sparring: access control.
-- Own club: full control. Other APPROVED clubs: read. Public: only public_show_calendar().

CREATE OR REPLACE FUNCTION app_club_approved() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM clubs WHERE id = app_club_id() AND status = 'approved') $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_club_approved() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_club_approved() TO ringportal_app;
--> statement-breakpoint
CREATE TRIGGER shows_touch_updated_at BEFORE UPDATE ON shows FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER opponent_requests_touch_updated_at BEFORE UPDATE ON opponent_requests FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER sparring_requests_touch_updated_at BEFORE UPDATE ON sparring_requests FOR EACH ROW EXECUTE FUNCTION app_touch_updated_at();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON shows, opponent_requests, sparring_requests, sparring_offers, sparring_attendance TO ringportal_app;
--> statement-breakpoint

ALTER TABLE shows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shows_admin_read ON shows FOR SELECT USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY shows_own ON shows FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id() AND app_club_approved());
--> statement-breakpoint
CREATE POLICY shows_approved_read ON shows FOR SELECT USING (app_context() = 'club' AND app_club_approved());
--> statement-breakpoint

ALTER TABLE opponent_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE opponent_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY opponent_requests_admin_read ON opponent_requests FOR SELECT USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY opponent_requests_own ON opponent_requests FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id() AND app_club_approved());
--> statement-breakpoint
CREATE POLICY opponent_requests_approved_read ON opponent_requests FOR SELECT USING (app_context() = 'club' AND app_club_approved());
--> statement-breakpoint

ALTER TABLE sparring_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sparring_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sparring_requests_admin_read ON sparring_requests FOR SELECT USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY sparring_requests_own ON sparring_requests FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id() AND app_club_approved());
--> statement-breakpoint
CREATE POLICY sparring_requests_approved_read ON sparring_requests FOR SELECT
  USING (app_context() = 'club' AND app_club_approved()
    AND (status = 'open' OR EXISTS (SELECT 1 FROM sparring_offers o WHERE o.request_id = sparring_requests.id AND o.offering_club_id = app_club_id())));
--> statement-breakpoint

ALTER TABLE sparring_offers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sparring_offers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sparring_offers_admin_read ON sparring_offers FOR SELECT USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY sparring_offers_party_read ON sparring_offers FOR SELECT
  USING (app_context() = 'club' AND app_club_id() IN (offering_club_id, request_club_id));
--> statement-breakpoint
CREATE POLICY sparring_offers_insert ON sparring_offers FOR INSERT
  WITH CHECK (app_context() = 'club' AND offering_club_id = app_club_id() AND app_club_approved() AND status = 'pending'
    AND request_club_id = (SELECT r.club_id FROM sparring_requests r WHERE r.id = request_id AND r.status = 'open'));
--> statement-breakpoint
CREATE POLICY sparring_offers_party_update ON sparring_offers FOR UPDATE
  USING (app_context() = 'club' AND app_club_id() IN (offering_club_id, request_club_id))
  WITH CHECK (app_context() = 'club' AND app_club_id() IN (offering_club_id, request_club_id));
--> statement-breakpoint
-- Only the requesting club decides an offer; only the offering club withdraws it; identity never changes.
CREATE OR REPLACE FUNCTION app_sparring_offers_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.request_id <> OLD.request_id OR NEW.request_club_id <> OLD.request_club_id OR NEW.offering_club_id <> OLD.offering_club_id
     OR NEW.partner_boxer_id <> OLD.partner_boxer_id THEN
    RAISE EXCEPTION 'sparring offer parties cannot be changed';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF OLD.status <> 'pending' AND NOT (OLD.status = 'approved' AND NEW.status = 'withdrawn') THEN
      RAISE EXCEPTION 'this sparring offer has already been decided';
    END IF;
    IF NEW.status IN ('approved', 'declined') AND app_club_id() <> OLD.request_club_id THEN
      RAISE EXCEPTION 'only the requesting club can decide a sparring offer';
    END IF;
    IF NEW.status = 'withdrawn' AND app_club_id() <> OLD.offering_club_id THEN
      RAISE EXCEPTION 'only the offering club can withdraw a sparring offer';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sparring_offers_guard BEFORE UPDATE ON sparring_offers FOR EACH ROW EXECUTE FUNCTION app_sparring_offers_guard();
--> statement-breakpoint

ALTER TABLE sparring_attendance ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sparring_attendance FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sparring_attendance_own ON sparring_attendance FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id()
    AND EXISTS (SELECT 1 FROM sparring_offers o WHERE o.id = offer_id AND o.status = 'approved' AND app_club_id() IN (o.offering_club_id, o.request_club_id)));
--> statement-breakpoint

-- Basic public calendar: name, date, host club, governing body, venue and the outward
-- part of the postcode. No contact route, requirements or other details. Demo clubs,
-- cancelled shows and shows the host chose not to list publicly are excluded.
CREATE OR REPLACE FUNCTION public_show_calendar()
RETURNS TABLE (id uuid, name text, starts_at timestamptz, host_club text, governing_body text, venue text, area text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.name, s.starts_at, c.name, g.name, s.venue, split_part(s.postcode, ' ', 1)
  FROM shows s
  JOIN clubs c ON c.id = s.club_id
  JOIN governing_bodies g ON g.id = c.governing_body_id
  WHERE s.status = 'scheduled' AND s.listed_publicly AND c.status = 'approved' AND NOT c.is_demo
    AND s.starts_at >= now() - interval '12 hours'
  ORDER BY s.starts_at, s.id
  LIMIT 200
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_show_calendar() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public_show_calendar() TO ringportal_app;
--> statement-breakpoint

-- Keeps both boxers' availability in step with a RingPortal bout: "Confirmed" when both
-- clubs have confirmed, back to "Ready" if that confirmed bout is later reopened or
-- withdrawn (unless the boxer has another confirmed bout). Callable only by a party.
CREATE OR REPLACE FUNCTION sync_bout_availability(p_proposal uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  p bout_proposals%ROWTYPE;
  b uuid;
  cur boxer_availability;
  target boxer_availability;
BEGIN
  SELECT * INTO p FROM bout_proposals WHERE id = p_proposal;
  IF NOT FOUND OR app_context() <> 'club' OR app_club_id() NOT IN (p.proposing_club_id, p.receiving_club_id) THEN
    RETURN;
  END IF;
  FOREACH b IN ARRAY ARRAY[p.proposing_boxer_id, p.receiving_boxer_id] LOOP
    SELECT availability INTO cur FROM boxers WHERE id = b FOR UPDATE;
    target := NULL;
    IF p.status = 'confirmed' AND cur IN ('ready', 'provisionally_arranged') THEN
      target := 'confirmed';
    ELSIF p.status <> 'confirmed' AND cur = 'confirmed' AND NOT EXISTS (
      SELECT 1 FROM bout_proposals o WHERE o.status = 'confirmed' AND b IN (o.proposing_boxer_id, o.receiving_boxer_id)) THEN
      target := 'ready';
    END IF;
    IF target IS NOT NULL THEN
      UPDATE boxers SET availability = target, availability_changed_at = now() WHERE id = b;
      INSERT INTO boxer_availability_history (boxer_id, club_id, from_status, to_status)
        SELECT b, club_id, cur, target FROM boxers WHERE id = b;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION sync_bout_availability(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION sync_bout_availability(uuid) TO ringportal_app;
