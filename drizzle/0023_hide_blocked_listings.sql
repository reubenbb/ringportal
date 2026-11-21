-- When two clubs have blocked each other (either way), neither sees the other's
-- open sparring requests or opponent requests. A club still sees a sparring
-- request it has already made an offer on, so its own offer history stays readable.

DROP POLICY sparring_requests_approved_read ON sparring_requests;
--> statement-breakpoint
CREATE POLICY sparring_requests_approved_read ON sparring_requests FOR SELECT
  USING (app_context() = 'club' AND app_club_approved()
    AND ((status = 'open' AND NOT blocked_with(club_id))
      OR EXISTS (SELECT 1 FROM sparring_offers o WHERE o.request_id = sparring_requests.id AND o.offering_club_id = app_club_id())));
--> statement-breakpoint
DROP POLICY opponent_requests_approved_read ON opponent_requests;
--> statement-breakpoint
CREATE POLICY opponent_requests_approved_read ON opponent_requests FOR SELECT
  USING (app_context() = 'club' AND app_club_approved() AND NOT blocked_with(club_id));
