-- booking-service owns the "booking" schema: everything that must be
-- transactionally consistent when tickets are sold.
-- Integrity rules live in the database (CHECKs, partial unique indexes, FKs) so
-- that no application bug can oversell an event or double-book a seat.

CREATE TYPE inventory_status AS ENUM ('draft', 'published', 'cancelled');
CREATE TYPE booking_status   AS ENUM ('confirmed', 'cancelled');
CREATE TYPE waitlist_status  AS ENUM ('waiting', 'promoted', 'left', 'expired');

-- Bookable inventory per event (event_id = catalog event id).
-- booked_count is the authoritative ticket counter; the CHECK makes
-- overselling impossible at the storage layer.
CREATE TABLE inventory (
  event_id          uuid PRIMARY KEY,
  name              text             NOT NULL,
  venue             text             NOT NULL,
  starts_at         timestamptz      NOT NULL,
  ends_at           timestamptz,
  capacity          integer          NOT NULL CHECK (capacity > 0),
  booked_count      integer          NOT NULL DEFAULT 0,
  price_cents       integer          NOT NULL CHECK (price_cents >= 0),
  max_per_booking   integer          NOT NULL CHECK (max_per_booking > 0),
  is_seated         boolean          NOT NULL DEFAULT false,
  status            inventory_status NOT NULL,
  catalog_version   integer          NOT NULL,
  inventory_version bigint           NOT NULL DEFAULT 0,
  updated_at        timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT inventory_booked_within_capacity CHECK (booked_count BETWEEN 0 AND capacity)
);

CREATE TABLE seats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid    NOT NULL REFERENCES inventory (event_id) ON DELETE CASCADE,
  row_label   text    NOT NULL,
  seat_number integer NOT NULL CHECK (seat_number > 0),
  UNIQUE (event_id, row_label, seat_number),
  UNIQUE (id, event_id) -- target for the composite FK in booking_seats
);

-- Bookings are never deleted; cancellation is a state transition.
CREATE TABLE bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid           NOT NULL,
  event_id          uuid           NOT NULL REFERENCES inventory (event_id),
  quantity          integer        NOT NULL CHECK (quantity > 0),
  status            booking_status NOT NULL DEFAULT 'confirmed',
  total_price_cents integer        NOT NULL CHECK (total_price_cents >= 0),
  source            text           NOT NULL DEFAULT 'direct' CHECK (source IN ('direct', 'waitlist')),
  idempotency_key   text,
  created_at        timestamptz    NOT NULL DEFAULT now(),
  cancelled_at      timestamptz,
  CONSTRAINT bookings_cancelled_at_matches_status CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX bookings_user_idempotency_key ON bookings (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX bookings_user_created_idx ON bookings (user_id, created_at DESC, id DESC);
CREATE INDEX bookings_event_status_idx ON bookings (event_id, status);

-- A seat may appear in many (historical) bookings but in at most ONE active one.
CREATE TABLE booking_seats (
  booking_id uuid    NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  seat_id    uuid    NOT NULL,
  event_id   uuid    NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (booking_id, seat_id),
  FOREIGN KEY (seat_id, event_id) REFERENCES seats (id, event_id)
);
CREATE UNIQUE INDEX booking_seats_one_active_per_seat ON booking_seats (seat_id) WHERE active;
CREATE INDEX booking_seats_event_active_idx ON booking_seats (event_id) WHERE active;

CREATE TABLE waitlist_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid            NOT NULL REFERENCES inventory (event_id),
  user_id    uuid            NOT NULL,
  quantity   integer         NOT NULL CHECK (quantity > 0),
  status     waitlist_status NOT NULL DEFAULT 'waiting',
  booking_id uuid REFERENCES bookings (id),
  created_at timestamptz     NOT NULL DEFAULT now(),
  updated_at timestamptz     NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX waitlist_one_active_per_user ON waitlist_entries (event_id, user_id) WHERE status = 'waiting';
CREATE INDEX waitlist_queue_idx ON waitlist_entries (event_id, created_at, id) WHERE status = 'waiting';
CREATE INDEX waitlist_user_idx  ON waitlist_entries (user_id, created_at DESC);

-- Read-only replica of auth-service users (fed by user.registered), used for attendee lists.
CREATE TABLE users (
  id    uuid PRIMARY KEY,
  email text NOT NULL,
  name  text NOT NULL
);

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
