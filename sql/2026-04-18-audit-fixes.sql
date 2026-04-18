-- YupSelf — audit P0 fixes (2026-04-18)
-- Запустить в Supabase SQL Editor ПЕРЕД деплоем кода.
-- Каждая миграция идемпотентна (IF NOT EXISTS / CREATE OR REPLACE).

-- ─────────────────────────────────────────────────────────────
-- 1) Атомарное начисление токенов (устраняет race condition
--    в addTokens / webhook YupPay / реферальных бонусах).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION add_tokens_atomic(
  p_telegram_id BIGINT,
  p_amount      INTEGER
) RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  new_balance INTEGER;
BEGIN
  UPDATE users
     SET tokens_balance = tokens_balance + p_amount,
         updated_at     = NOW()
   WHERE telegram_id = p_telegram_id
  RETURNING tokens_balance INTO new_balance;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'balance', 0);
  END IF;

  RETURN json_build_object('ok', true, 'balance', new_balance);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2) Soft-delete для saved_faces (правило CLAUDE.md #4).
--    Добавляем колонку status с дефолтом 'active'; существующие
--    строки остаются активными. Код фильтрует status != 'deleted'.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE saved_faces
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Индекс для быстрой выборки активных лиц пользователя
CREATE INDEX IF NOT EXISTS idx_saved_faces_user_status
  ON saved_faces (telegram_id, status);

-- ─────────────────────────────────────────────────────────────
-- 3) Идемпотентность YupPay webhook (P1 #8 из аудита).
--    Уникальный индекс по invoice_id не даст начислить дважды,
--    даже если in-memory Set очистился после рестарта Render.
--    Реализация в коде: `insert ... on conflict do nothing` на
--    таблицу processed_invoices перед начислением.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_invoices (
  invoice_id   TEXT PRIMARY KEY,
  telegram_id  BIGINT NOT NULL,
  tokens       INTEGER NOT NULL,
  package_id   TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- 4) Jobs: owner_id для owner-check + rating для оценок (P2).
--    owner_id нужен, чтобы /api/job/:id и /api/download/:id
--    после рестарта pod'а могли проверить, что к джобу обращается
--    его создатель (иначе угадав случайный jobId, можно было бы
--    прочитать чужой результат).
--    rating — 1..5 звёзд, nullable; пишется POST /api/job/:id/rating.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS owner_id BIGINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rating   SMALLINT
  CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);

-- Индекс для поиска зомби-джобов на старте ("processing" + старая updated_at)
CREATE INDEX IF NOT EXISTS idx_jobs_status_updated
  ON jobs (status, updated_at);
