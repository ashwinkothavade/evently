-- notify-service owns the "notify" schema: the notification inbox plus
-- read models (projections) built from other services' integration events.
-- Analytics queries hit these projections, never the booking database.

CREATE TABLE users (
  id    uuid PRIMARY KEY,
  email text NOT NULL,
  name  text NOT NULL,
  role  text NOT NULL
);

CREATE TABLE event_stats (
  event_id          uuid PRIMARY KEY,
  name              text        NOT NULL DEFAULT '',
  venue             text        NOT NULL DEFAULT '',
  starts_at         timestamptz,
  status            text        NOT NULL DEFAULT 'published',
  price_cents       integer     NOT NULL DEFAULT 0,
  capacity          integer     NOT NULL DEFAULT 0,
  booked_count      integer     NOT NULL DEFAULT 0,
  waitlist_size     integer     NOT NULL DEFAULT 0,
  catalog_version   integer     NOT NULL DEFAULT 0,
  inventory_version bigint      NOT NULL DEFAULT 0
);
CREATE INDEX event_stats_status_idx ON event_stats (status, starts_at);

CREATE TABLE booking_facts (
  booking_id        uuid PRIMARY KEY,
  event_id          uuid        NOT NULL,
  user_id           uuid        NOT NULL,
  quantity          integer     NOT NULL,
  total_price_cents integer     NOT NULL,
  source            text        NOT NULL,
  status            text        NOT NULL DEFAULT 'confirmed',
  cancel_reason     text,
  created_at        timestamptz NOT NULL,
  cancelled_at      timestamptz
);
CREATE INDEX booking_facts_event_idx        ON booking_facts (event_id, status);
CREATE INDEX booking_facts_created_at_idx   ON booking_facts (created_at);
CREATE INDEX booking_facts_cancelled_at_idx ON booking_facts (cancelled_at) WHERE cancelled_at IS NOT NULL;

-- In-app inbox; delivered_at IS NULL means "pending external delivery".
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,
  type         text        NOT NULL,
  title        text        NOT NULL,
  body         text        NOT NULL,
  data         jsonb       NOT NULL DEFAULT '{}',
  read_at      timestamptz,
  delivered_at timestamptz,
  attempts     integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_undelivered_idx  ON notifications (created_at) WHERE delivered_at IS NULL;

CREATE TABLE processed_events (
  event_id     uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
