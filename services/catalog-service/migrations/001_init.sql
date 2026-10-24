-- catalog-service owns the "catalog" schema: the descriptive side of events.
-- booked_count here is a read-model replica fed by booking-service's
-- inventory.changed events; booking-service's inventory is authoritative.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE TYPE event_status AS ENUM ('draft', 'published', 'cancelled');

CREATE TABLE events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text         NOT NULL,
  description       text,
  venue             text         NOT NULL,
  starts_at         timestamptz  NOT NULL,
  ends_at           timestamptz,
  capacity          integer      NOT NULL CHECK (capacity > 0),
  price_cents       integer      NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  max_per_booking   integer      NOT NULL DEFAULT 10 CHECK (max_per_booking > 0),
  seat_rows         integer      CHECK (seat_rows BETWEEN 1 AND 26),
  seats_per_row     integer      CHECK (seats_per_row BETWEEN 1 AND 100),
  status            event_status NOT NULL DEFAULT 'published',
  cancel_reason     text,
  version           integer      NOT NULL DEFAULT 1,
  booked_count      integer      NOT NULL DEFAULT 0,
  inventory_version bigint       NOT NULL DEFAULT 0,
  created_by        uuid,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT events_valid_time_range CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT events_seating_complete CHECK ((seat_rows IS NULL) = (seats_per_row IS NULL))
);
CREATE INDEX events_published_starts_at_idx ON events (starts_at, id) WHERE status = 'published';
CREATE INDEX events_name_trgm_idx  ON events USING gin (name public.gin_trgm_ops);
CREATE INDEX events_venue_trgm_idx ON events USING gin (venue public.gin_trgm_ops);

CREATE TABLE outbox (
  seq          bigserial PRIMARY KEY,
  id           uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  type         text        NOT NULL,
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON outbox (seq) WHERE published_at IS NULL;

CREATE TABLE processed_events (
  event_id     uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
