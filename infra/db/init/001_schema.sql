-- Collector V3 - minimal schema (dev)
-- Runs automatically via Postgres docker-entrypoint-initdb.d on first volume init.

BEGIN;

CREATE TABLE IF NOT EXISTS app_user (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bill (
  id           BIGSERIAL PRIMARY KEY,
  vendor_id    BIGINT REFERENCES vendor(id),
  bill_no      TEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'USD',
  status       TEXT NOT NULL DEFAULT 'draft',
  due_date     DATE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_check (
  id            BIGSERIAL PRIMARY KEY,
  bill_id       BIGINT REFERENCES bill(id),
  check_no      TEXT,
  payee         TEXT,
  amount_cents  BIGINT NOT NULL DEFAULT 0,
  issued_date   DATE,
  status        TEXT NOT NULL DEFAULT 'created',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
