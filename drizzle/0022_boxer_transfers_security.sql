-- Boxer transfers: the new club requests, the current club approves or declines,
-- the requesting club can cancel while pending.
-- * The app role can only READ transfers it is party to. Every state change goes
--   through a SECURITY DEFINER function below, which checks the caller's club.
-- * On approval the boxer and its private record move to the new club. The old
--   club's internal notes and guardian-consent record do not travel: the new club
--   must confirm consent itself. The boxer arrives as 'inactive' so it does not
--   appear in matchmaking until the new club has checked the record.
-- * Availability history rows stay with the club that wrote them.

GRANT SELECT ON boxer_transfers TO ringportal_app;
--> statement-breakpoint
ALTER TABLE boxer_transfers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE boxer_transfers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY boxer_transfers_admin_read ON boxer_transfers FOR SELECT USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY boxer_transfers_party_read ON boxer_transfers FOR SELECT
  USING (app_context() = 'club' AND app_club_id() IN (from_club_id, to_club_id));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_assert_club_user(p_user uuid) RETURNS void
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF app_context() <> 'club' OR app_club_id() IS NULL THEN
    RAISE EXCEPTION 'club context required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM club_users u WHERE u.id = p_user AND u.club_id = app_club_id() AND u.status = 'active') THEN
    RAISE EXCEPTION 'club user does not belong to this club';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_assert_club_user(uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION request_boxer_transfer(p_boxer uuid, p_user uuid, p_note text, OUT result text, OUT transfer_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  owner_club uuid;
BEGIN
  PERFORM app_assert_club_user(p_user);
  IF NOT app_club_approved() THEN
    result := 'not_approved'; RETURN;
  END IF;
  SELECT b.club_id INTO owner_club
    FROM boxers b JOIN clubs c ON c.id = b.club_id
    WHERE b.id = p_boxer AND b.archived_at IS NULL AND c.status = 'approved';
  IF owner_club IS NULL THEN
    result := 'not_found'; RETURN;
  END IF;
  IF owner_club = app_club_id() THEN
    result := 'own_boxer'; RETURN;
  END IF;
  IF blocked_with(owner_club) THEN
    result := 'blocked'; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM boxer_transfers t WHERE t.boxer_id = p_boxer AND t.status = 'pending') THEN
    result := 'pending_exists'; RETURN;
  END IF;
  INSERT INTO boxer_transfers (boxer_id, from_club_id, to_club_id, note, requested_by)
    VALUES (p_boxer, owner_club, app_club_id(), nullif(trim(p_note), ''), p_user)
    RETURNING id INTO transfer_id;
  result := 'requested';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION request_boxer_transfer(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION request_boxer_transfer(uuid, uuid, text) TO ringportal_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION decide_boxer_transfer(p_transfer uuid, p_user uuid, p_approve boolean) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  t boxer_transfers%ROWTYPE;
  b boxers%ROWTYPE;
BEGIN
  PERFORM app_assert_club_user(p_user);
  SELECT * INTO t FROM boxer_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND OR t.from_club_id <> app_club_id() THEN
    RETURN 'not_found';
  END IF;
  IF t.status <> 'pending' THEN
    RETURN 'not_pending';
  END IF;
  IF NOT p_approve THEN
    UPDATE boxer_transfers SET status = 'declined', decided_by = p_user, decided_at = now() WHERE id = t.id;
    RETURN 'declined';
  END IF;

  SELECT * INTO b FROM boxers WHERE id = t.boxer_id FOR UPDATE;
  IF b.club_id <> t.from_club_id THEN RETURN 'moved'; END IF;
  IF b.archived_at IS NOT NULL THEN RETURN 'archived'; END IF;
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = t.to_club_id AND status = 'approved') THEN RETURN 'other_not_approved'; END IF;
  IF blocked_with(t.to_club_id) THEN RETURN 'blocked'; END IF;
  IF b.availability = 'confirmed' THEN RETURN 'busy_bout'; END IF;
  IF EXISTS (SELECT 1 FROM bout_proposals p WHERE b.id IN (p.proposing_boxer_id, p.receiving_boxer_id)
               AND p.status IN ('sent', 'negotiating', 'accepted_in_principle', 'awaiting_confirmation')) THEN
    RETURN 'busy_proposal';
  END IF;
  IF EXISTS (SELECT 1 FROM sparring_requests r WHERE r.boxer_id = b.id AND r.status IN ('open', 'arranged'))
     OR EXISTS (SELECT 1 FROM sparring_offers o JOIN sparring_requests r ON r.id = o.request_id
                WHERE o.partner_boxer_id = b.id
                  AND (o.status = 'pending' OR (o.status = 'approved' AND r.status = 'arranged'))) THEN
    RETURN 'busy_sparring';
  END IF;
  IF EXISTS (SELECT 1 FROM opponent_requests q WHERE q.boxer_id = b.id AND q.status = 'open') THEN
    RETURN 'busy_request';
  END IF;

  UPDATE boxers SET club_id = t.to_club_id, availability = 'inactive', availability_changed_at = now() WHERE id = b.id;
  UPDATE boxer_private SET club_id = t.to_club_id, notes = NULL, guardian_consent_at = NULL, guardian_consent_by = NULL WHERE boxer_id = b.id;
  INSERT INTO boxer_availability_history (boxer_id, club_id, from_status, to_status, changed_by)
    VALUES (b.id, t.to_club_id, b.availability, 'inactive', NULL);
  UPDATE boxer_transfers SET status = 'approved', decided_by = p_user, decided_at = now() WHERE id = t.id;
  RETURN 'approved';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION decide_boxer_transfer(uuid, uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION decide_boxer_transfer(uuid, uuid, boolean) TO ringportal_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION cancel_boxer_transfer(p_transfer uuid, p_user uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  t boxer_transfers%ROWTYPE;
BEGIN
  PERFORM app_assert_club_user(p_user);
  SELECT * INTO t FROM boxer_transfers WHERE id = p_transfer FOR UPDATE;
  IF NOT FOUND OR t.to_club_id <> app_club_id() THEN
    RETURN 'not_found';
  END IF;
  IF t.status <> 'pending' THEN
    RETURN 'not_pending';
  END IF;
  UPDATE boxer_transfers SET status = 'cancelled', decided_by = p_user, decided_at = now() WHERE id = t.id;
  RETURN 'cancelled';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION cancel_boxer_transfer(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION cancel_boxer_transfer(uuid, uuid) TO ringportal_app;
