-- V3: schema additions from docs/devops.md 6.3 / 6.4 that V1 is missing.
-- V1 and V2 may already be applied on dev databases, so they are not edited (README sec 6).

-- pgcrypto: crypt()/gen_salt('bf') for seeded BCrypt passwords, digest() for receipt SHA-256 in seeds.
-- Trusted extension since PG 13, so the database owner (app) can create it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Payout retry with several backend replicas (devops.md 6.4):
--   SELECT ... WHERE status = 'PENDING_SEND' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
--   ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED;
-- On a failed send the backend sets next_attempt_at = now() + retry interval.
ALTER TABLE payout_batches ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payout_batches_pending
    ON payout_batches (next_attempt_at, created_at)
    WHERE status = 'PENDING_SEND';

-- Entities map these hashes as String (varchar). CHAR(64) (bpchar) fails ddl-auto=validate.
-- Values are always 64 hex chars, so no data change.
ALTER TABLE receipts         ALTER COLUMN sha256       TYPE VARCHAR(64);
ALTER TABLE idempotency_keys ALTER COLUMN request_hash TYPE VARCHAR(64);

-- Keep the hash format honest at the database (last line of defence, NFR-SEC-3).
ALTER TABLE receipts
    ADD CONSTRAINT chk_receipts_sha256_hex CHECK (sha256 ~ '^[0-9a-f]{64}$');
