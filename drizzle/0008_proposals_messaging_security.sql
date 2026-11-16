-- Bout proposals and club-to-club messaging: access control.
-- * Proposals, their versions, confirmations and events: the two clubs involved (and admins, read-only).
-- * Conversations and messages: the two clubs involved (and admins, read-only, for moderation/audit).
-- * Each club sees only its own read position / archive flag.
-- * Versions, confirmations, events and messages are immutable once written.
-- * Party and boxer identity columns can never be changed after creation.
-- * Other clubs' names and boxers are read only through minimised SECURITY DEFINER functions.

CREATE OR REPLACE FUNCTION app_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
--> statement-breakpoint
CREATE TRIGGER bout_proposal_versions_append_only BEFORE UPDATE OR DELETE ON bout_proposal_versions
  FOR EACH ROW EXECUTE FUNCTION app_append_only();
--> statement-breakpoint
CREATE TRIGGER bout_proposal_confirmations_append_only BEFORE UPDATE OR DELETE ON bout_proposal_confirmations
  FOR EACH ROW EXECUTE FUNCTION app_append_only();
--> statement-breakpoint
CREATE TRIGGER bout_proposal_events_append_only BEFORE UPDATE OR DELETE ON bout_proposal_events
  FOR EACH ROW EXECUTE FUNCTION app_append_only();
--> statement-breakpoint
CREATE TRIGGER messages_append_only BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION app_append_only();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_bout_proposals_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.proposing_club_id <> OLD.proposing_club_id OR NEW.receiving_club_id <> OLD.receiving_club_id
     OR NEW.proposing_boxer_id <> OLD.proposing_boxer_id OR NEW.receiving_boxer_id <> OLD.receiving_boxer_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'proposal parties and boxers cannot be changed';
  END IF;
  IF NEW.current_version < OLD.current_version THEN
    RAISE EXCEPTION 'proposal version cannot go backwards';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bout_proposals_guard BEFORE UPDATE ON bout_proposals
  FOR EACH ROW EXECUTE FUNCTION app_bout_proposals_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_conversations_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.club_low_id <> OLD.club_low_id OR NEW.club_high_id <> OLD.club_high_id OR NEW.kind <> OLD.kind
     OR NEW.boxer_id IS DISTINCT FROM OLD.boxer_id OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
     OR NEW.started_by_club_id <> OLD.started_by_club_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'conversation parties and links cannot be changed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER conversations_guard BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION app_conversations_guard();
--> statement-breakpoint

-- Grants (no DELETE anywhere) ---------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON bout_proposals, conversations, conversation_club_state TO ringportal_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON bout_proposal_versions, bout_proposal_confirmations, bout_proposal_events, messages TO ringportal_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE bout_proposal_events_id_seq, messages_id_seq TO ringportal_app;
--> statement-breakpoint

-- Row-level security -------------------------------------------------------------
ALTER TABLE bout_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bout_proposals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bout_proposals_admin_read ON bout_proposals FOR SELECT
  USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY bout_proposals_party_read ON bout_proposals FOR SELECT
  USING (app_context() = 'club' AND app_club_id() IN (proposing_club_id, receiving_club_id));
--> statement-breakpoint
CREATE POLICY bout_proposals_insert ON bout_proposals FOR INSERT
  WITH CHECK (app_context() = 'club' AND proposing_club_id = app_club_id());
--> statement-breakpoint
CREATE POLICY bout_proposals_party_update ON bout_proposals FOR UPDATE
  USING (app_context() = 'club' AND app_club_id() IN (proposing_club_id, receiving_club_id))
  WITH CHECK (app_context() = 'club' AND app_club_id() IN (proposing_club_id, receiving_club_id));
--> statement-breakpoint

ALTER TABLE bout_proposal_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bout_proposal_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bout_proposal_versions_admin_read ON bout_proposal_versions FOR SELECT
  USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY bout_proposal_versions_party_read ON bout_proposal_versions FOR SELECT
  USING (app_context() = 'club' AND EXISTS (SELECT 1 FROM bout_proposals p WHERE p.id = proposal_id));
--> statement-breakpoint
CREATE POLICY bout_proposal_versions_insert ON bout_proposal_versions FOR INSERT
  WITH CHECK (app_context() = 'club' AND author_club_id = app_club_id()
    AND EXISTS (SELECT 1 FROM bout_proposals p WHERE p.id = proposal_id));
--> statement-breakpoint

ALTER TABLE bout_proposal_confirmations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bout_proposal_confirmations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bout_proposal_confirmations_admin_read ON bout_proposal_confirmations FOR SELECT
  USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY bout_proposal_confirmations_party_read ON bout_proposal_confirmations FOR SELECT
  USING (app_context() = 'club' AND EXISTS (SELECT 1 FROM bout_proposals p WHERE p.id = proposal_id));
--> statement-breakpoint
CREATE POLICY bout_proposal_confirmations_insert ON bout_proposal_confirmations FOR INSERT
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id()
    AND EXISTS (SELECT 1 FROM bout_proposals p WHERE p.id = proposal_id));
--> statement-breakpoint

ALTER TABLE bout_proposal_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bout_proposal_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY bout_proposal_events_admin_read ON bout_proposal_events FOR SELECT
  USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY bout_proposal_events_party_read ON bout_proposal_events FOR SELECT
  USING (app_context() = 'club' AND EXISTS (SELECT 1 FROM bout_proposals p WHERE p.id = proposal_id));
--> statement-breakpoint
CREATE POLICY bout_proposal_events_insert ON bout_proposal_events FOR INSERT
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id()
    AND EXISTS (SELECT 1 FROM bout_proposals p WHERE p.id = proposal_id));
--> statement-breakpoint

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY conversations_admin_read ON conversations FOR SELECT
  USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY conversations_party_read ON conversations FOR SELECT
  USING (app_context() = 'club' AND app_club_id() IN (club_low_id, club_high_id));
--> statement-breakpoint
CREATE POLICY conversations_insert ON conversations FOR INSERT
  WITH CHECK (app_context() = 'club' AND started_by_club_id = app_club_id() AND app_club_id() IN (club_low_id, club_high_id));
--> statement-breakpoint
CREATE POLICY conversations_party_update ON conversations FOR UPDATE
  USING (app_context() = 'club' AND app_club_id() IN (club_low_id, club_high_id))
  WITH CHECK (app_context() = 'club' AND app_club_id() IN (club_low_id, club_high_id));
--> statement-breakpoint

ALTER TABLE conversation_club_state ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversation_club_state FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY conversation_club_state_own ON conversation_club_state FOR ALL
  USING (app_context() = 'club' AND club_id = app_club_id())
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id()
    AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id));
--> statement-breakpoint

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY messages_admin_read ON messages FOR SELECT
  USING (app_context() = 'admin');
--> statement-breakpoint
CREATE POLICY messages_party_read ON messages FOR SELECT
  USING (app_context() = 'club' AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id));
--> statement-breakpoint
CREATE POLICY messages_insert ON messages FOR INSERT
  WITH CHECK (app_context() = 'club' AND sender_club_id = app_club_id()
    AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_id));
--> statement-breakpoint

-- Minimised cross-club reads ------------------------------------------------------

-- Names of other clubs, for approved clubs and admins. A club is named if it is
-- approved, or if it already shares a proposal or conversation with the caller.
CREATE OR REPLACE FUNCTION club_names(ids uuid[])
RETURNS TABLE (id uuid, name text, slug text, is_demo boolean, approved boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id, c.name, c.slug, c.is_demo, c.status = 'approved'
  FROM clubs c
  WHERE c.id = ANY(ids)
    AND (
      app_context() = 'admin'
      OR (app_context() = 'club' AND (
            c.id = app_club_id()
            OR (EXISTS (SELECT 1 FROM clubs me WHERE me.id = app_club_id() AND me.status = 'approved')
                AND (c.status = 'approved'
                     OR EXISTS (SELECT 1 FROM bout_proposals p
                                WHERE (p.proposing_club_id = app_club_id() AND p.receiving_club_id = c.id)
                                   OR (p.receiving_club_id = app_club_id() AND p.proposing_club_id = c.id))
                     OR EXISTS (SELECT 1 FROM conversations v
                                WHERE (v.club_low_id = app_club_id() AND v.club_high_id = c.id)
                                   OR (v.club_high_id = app_club_id() AND v.club_low_id = c.id))))))
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION club_names(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION club_names(uuid[]) TO ringportal_app;
--> statement-breakpoint

-- Minimised boxer cards (same fields and junior masking as club_boxer_roster).
-- Visible to: the boxer's own club (full name); admins; approved clubs, for active
-- boxers of approved clubs, or for any boxer already in a proposal or boxer
-- conversation with the caller.
CREATE OR REPLACE FUNCTION boxer_cards(ids uuid[])
RETURNS TABLE (
  id uuid,
  club_id uuid,
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
  archived boolean,
  club_approved boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    b.id,
    b.club_id,
    CASE WHEN b.club_id = app_club_id() OR date_part('year', age(current_date, p.date_of_birth)) >= 18
         THEN b.first_name || ' ' || b.last_name
         ELSE b.first_name || ' ' || left(b.last_name, 1) || '.' END,
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
    b.archived_at IS NOT NULL,
    c.status = 'approved'
  FROM boxers b
  JOIN boxer_private p ON p.boxer_id = b.id
  JOIN clubs c ON c.id = b.club_id
  WHERE b.id = ANY(ids)
    AND (
      app_context() = 'admin'
      OR (app_context() = 'club' AND (
            b.club_id = app_club_id()
            OR (EXISTS (SELECT 1 FROM clubs me WHERE me.id = app_club_id() AND me.status = 'approved')
                AND ((c.status = 'approved' AND b.archived_at IS NULL)
                     OR EXISTS (SELECT 1 FROM bout_proposals bp
                                WHERE app_club_id() IN (bp.proposing_club_id, bp.receiving_club_id)
                                  AND b.id IN (bp.proposing_boxer_id, bp.receiving_boxer_id))
                     OR EXISTS (SELECT 1 FROM conversations v
                                WHERE v.kind = 'boxer' AND v.boxer_id = b.id
                                  AND app_club_id() IN (v.club_low_id, v.club_high_id))))))
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION boxer_cards(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION boxer_cards(uuid[]) TO ringportal_app;
