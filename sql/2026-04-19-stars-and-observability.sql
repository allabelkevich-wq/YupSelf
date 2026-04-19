-- YupSelf — round-4 infra additions (2026-04-19)
-- Run in Supabase SQL Editor after merging code.
-- Every statement is idempotent.

-- ─────────────────────────────────────────────────────────────
-- 1) Telegram Stars idempotency table.
--    Primary key = telegram_payment_charge_id (globally unique per
--    payment in Telegram). Duplicate successful_payment updates from
--    Telegram retries collapse to a unique_violation and we skip
--    re-crediting the user's Искры.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_stars_invoices (
  charge_id       TEXT PRIMARY KEY,
  telegram_id     BIGINT NOT NULL,
  tokens          INTEGER NOT NULL,
  package_id      TEXT,
  stars           INTEGER NOT NULL,
  invoice_payload TEXT,
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stars_invoices_user
  ON processed_stars_invoices (telegram_id, processed_at DESC);
