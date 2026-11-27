-- ExpenseFlow V1 schema. Mirrors README section 6.
-- Conventions: snake_case, BIGSERIAL PKs, NUMERIC(12,2) for money,
-- TIMESTAMPTZ for timestamps, enums as VARCHAR + CHECK.

CREATE TABLE departments (
    id        BIGSERIAL PRIMARY KEY,
    code      VARCHAR(32)  NOT NULL UNIQUE,
    name      VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employees (
    id             BIGSERIAL PRIMARY KEY,
    employee_code  VARCHAR(32)  NOT NULL UNIQUE,
    name           VARCHAR(128) NOT NULL,
    email          VARCHAR(190) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    role           VARCHAR(16)  NOT NULL
        CHECK (role IN ('EMPLOYEE','MANAGER','AUDITOR','HEAD')),
    department_id  BIGINT       NOT NULL REFERENCES departments(id),
    manager_id     BIGINT       REFERENCES employees(id),
    account_number VARCHAR(32)  NOT NULL,
    ifsc           VARCHAR(16)  NOT NULL,
    active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_employees_manager ON employees(manager_id);
CREATE INDEX idx_employees_role    ON employees(role) WHERE active;

CREATE TABLE city_tiers (
    city VARCHAR(64) PRIMARY KEY,
    tier SMALLINT    NOT NULL CHECK (tier BETWEEN 1 AND 3)
);

CREATE TABLE policy_rules (
    id           BIGSERIAL PRIMARY KEY,
    code         VARCHAR(32)   NOT NULL UNIQUE,
    category     VARCHAR(16)   NOT NULL
        CHECK (category IN ('MEALS','HOTEL','LOCAL_CAB','FLIGHT','TRAIN','OTHER')),
    limit_amount NUMERIC(12,2) NOT NULL,
    unit         VARCHAR(32)   NOT NULL,
    city_tier    SMALLINT,
    active       BOOLEAN       NOT NULL DEFAULT TRUE,
    description  VARCHAR(255)
);

CREATE TABLE app_settings (
    key         VARCHAR(64) PRIMARY KEY,
    value       VARCHAR(128) NOT NULL,
    description VARCHAR(255)
);

CREATE TABLE receipts (
    id           BIGSERIAL PRIMARY KEY,
    owner_id     BIGINT       NOT NULL REFERENCES employees(id),
    file_name    VARCHAR(255) NOT NULL,
    content_type VARCHAR(64)  NOT NULL,
    size_bytes   INTEGER      NOT NULL CHECK (size_bytes > 0),
    sha256       CHAR(64)     NOT NULL,
    data         BYTEA        NOT NULL,
    uploaded_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_sha256 ON receipts(sha256);
CREATE INDEX idx_receipts_owner  ON receipts(owner_id);

CREATE TABLE claims (
    id                BIGSERIAL PRIMARY KEY,
    claim_number      VARCHAR(32)  NOT NULL UNIQUE,
    employee_id       BIGINT       NOT NULL REFERENCES employees(id),
    title             VARCHAR(160) NOT NULL,
    status            VARCHAR(32)  NOT NULL
        CHECK (status IN (
            'DRAFT','SUBMITTED',
            'PENDING_MANAGER','PENDING_AUDITOR','PENDING_HEAD',
            'NEEDS_CLARIFICATION',
            'APPROVED','REJECTED',
            'IN_PAYOUT','PAID'
        )),
    total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    sample_audit      VARCHAR(16)  NOT NULL DEFAULT 'NONE'
        CHECK (sample_audit IN ('NONE','OPEN','CLEARED','FAILED')),
    submitted_at      TIMESTAMPTZ,
    final_decision_at TIMESTAMPTZ,
    paid_at           TIMESTAMPTZ,
    payout_batch_id   BIGINT,
    version           BIGINT       NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_claims_employee_status ON claims(employee_id, status);
CREATE INDEX idx_claims_status_submitted ON claims(status, submitted_at);

CREATE TABLE claim_lines (
    id           BIGSERIAL PRIMARY KEY,
    claim_id     BIGINT       NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
    line_no      SMALLINT     NOT NULL,
    category     VARCHAR(16)  NOT NULL
        CHECK (category IN ('MEALS','HOTEL','LOCAL_CAB','FLIGHT','TRAIN','OTHER')),
    expense_date DATE         NOT NULL,
    amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    vendor       VARCHAR(120) NOT NULL,
    city         VARCHAR(64),
    nights       SMALLINT,
    description  VARCHAR(500),
    receipt_id   BIGINT       REFERENCES receipts(id),
    outcome      VARCHAR(16)
        CHECK (outcome IN ('AUTO_APPROVE','ROUTE','AUTO_REJECT')),
    flags        TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
    reason       VARCHAR(500),
    UNIQUE (claim_id, line_no)
);
CREATE INDEX idx_claim_lines_date_amount ON claim_lines(expense_date, amount);
CREATE INDEX idx_claim_lines_vendor_lower ON claim_lines(LOWER(vendor));
CREATE INDEX idx_claim_lines_receipt ON claim_lines(receipt_id);

CREATE TABLE approval_steps (
    id           BIGSERIAL PRIMARY KEY,
    claim_id     BIGINT      NOT NULL REFERENCES claims(id),
    level        VARCHAR(16) NOT NULL
        CHECK (level IN ('MANAGER','AUDITOR','HEAD')),
    approver_id  BIGINT      NOT NULL REFERENCES employees(id),
    acted_by_id  BIGINT      NOT NULL REFERENCES employees(id),
    decision     VARCHAR(16) NOT NULL
        CHECK (decision IN ('APPROVED','SENT_BACK','REJECTED')),
    comment      VARCHAR(500),
    decided_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_steps_claim ON approval_steps(claim_id);

CREATE TABLE claim_comments (
    id         BIGSERIAL PRIMARY KEY,
    claim_id   BIGINT       NOT NULL REFERENCES claims(id),
    author_id  BIGINT       NOT NULL REFERENCES employees(id),
    body       VARCHAR(1000) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_claim_comments_claim ON claim_comments(claim_id);

CREATE TABLE delegations (
    id           BIGSERIAL PRIMARY KEY,
    approver_id  BIGINT NOT NULL REFERENCES employees(id),
    delegate_id  BIGINT NOT NULL REFERENCES employees(id),
    from_date    DATE   NOT NULL,
    to_date      DATE   NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_date <= to_date),
    CHECK (approver_id <> delegate_id)
);
CREATE INDEX idx_delegations_approver ON delegations(approver_id, from_date, to_date);
CREATE INDEX idx_delegations_delegate ON delegations(delegate_id, from_date, to_date);

CREATE TABLE payout_batches (
    id             BIGSERIAL PRIMARY KEY,
    batch_ref      VARCHAR(32)  NOT NULL UNIQUE,
    status         VARCHAR(16)  NOT NULL
        CHECK (status IN ('PENDING_SEND','SENT')),
    claim_count    INTEGER      NOT NULL,
    total_amount   NUMERIC(14,2) NOT NULL,
    file_name      VARCHAR(255) NOT NULL,
    csv_content    TEXT         NOT NULL,
    attempts       INTEGER      NOT NULL DEFAULT 0,
    last_error     VARCHAR(500),
    bank_reference VARCHAR(64),
    created_by     BIGINT       NOT NULL REFERENCES employees(id),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    sent_at        TIMESTAMPTZ
);
CREATE INDEX idx_payout_batches_status ON payout_batches(status);

ALTER TABLE claims
    ADD CONSTRAINT fk_claims_payout_batch
    FOREIGN KEY (payout_batch_id) REFERENCES payout_batches(id);

CREATE TABLE audit_events (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        BIGINT REFERENCES employees(id),
    on_behalf_of_id BIGINT REFERENCES employees(id),
    action          VARCHAR(64)  NOT NULL,
    entity_type     VARCHAR(32)  NOT NULL,
    entity_id       BIGINT,
    claim_id        BIGINT,
    from_status     VARCHAR(32),
    to_status       VARCHAR(32),
    details         JSONB        NOT NULL DEFAULT '{}'::JSONB,
    correlation_id  VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_events_claim ON audit_events(claim_id);
CREATE INDEX idx_audit_events_created ON audit_events(created_at);

-- R14: audit_events is append-only. UPDATE and DELETE are rejected at the database.
CREATE OR REPLACE FUNCTION audit_events_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only (operation=%)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_events_no_update
BEFORE UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

CREATE TRIGGER trg_audit_events_no_delete
BEFORE DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION audit_events_block_mutation();

CREATE TABLE idempotency_keys (
    id              BIGSERIAL PRIMARY KEY,
    idem_key        VARCHAR(80)  NOT NULL,
    user_id         BIGINT       NOT NULL REFERENCES employees(id),
    endpoint        VARCHAR(128) NOT NULL,
    request_hash    CHAR(64)     NOT NULL,
    response_status INTEGER      NOT NULL,
    response_body   JSONB,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (idem_key, user_id)
);

-- Sequences for human-readable identifiers.
-- Claim number: EXP-YYYY-NNNNNN (6-digit zero-padded, per-year).
-- Batch ref:    PB-YYYYMMDD-NNN (3-digit zero-padded, per-day).
CREATE SEQUENCE claim_number_seq START 1;
CREATE SEQUENCE payout_batch_seq START 1;
