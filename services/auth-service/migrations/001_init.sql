-- auth-service owns the "auth" schema.
CREATE TYPE user_role AS ENUM ('user', 'admin');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  name          text        NOT NULL,
  password_hash text        NOT NULL,
  role          user_role   NOT NULL DEFAULT 'user',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE outbox (
  seq          bigserial PRIMARY KEY,
  id           uuid        NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  type         text        NOT NULL,
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON outbox (seq) WHERE published_at IS NULL;
