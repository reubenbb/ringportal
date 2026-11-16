-- A registered club may request a claim on a directory record itself (pending until an administrator decides).
CREATE POLICY club_claims_own_insert ON club_claims FOR INSERT
  WITH CHECK (app_context() = 'club' AND club_id = app_club_id() AND status = 'pending' AND decided_by IS NULL);
