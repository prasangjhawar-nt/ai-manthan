-- V5: synthetic claims (README sec 11, devops.md 6.3).
--   3,000 historical claims over the last 12 months (mostly PAID), 1-5 lines each, placeholder PDF receipts,
--   approval steps, monthly SENT payout batches, one SEEDED audit event per claim.
--   Planted: ~5% duplicate lines (same employee+vendor+amount+date), ~2% reused receipt bytes (same SHA-256),
--   ~8% limit breaches, ~10% weekend lines.
--   Current queue: ~40 claims submitted in the last 24 h + 1 stuck claim 3 days old (fires OldestPendingApprovalTooOld).
--   Demo safety: emp.demo only gets claims older than 100 days, so the golden-flow claim (README sec 3) is not
--   affected by R1 (daily meal sum) or R5 (duplicates). No IN_PAYOUT/PENDING_SEND rows, so BankPayoutFailing starts inactive.
-- Deterministic: setseed() first – same data on every reset.

SELECT setseed(0.45);

-- Small valid-enough PDF so the receipt viewer shows something; text makes every file (and hash) unique.
CREATE FUNCTION pg_temp.seed_pdf(label TEXT) RETURNS BYTEA LANGUAGE sql AS $$
    SELECT convert_to(
        '%PDF-1.4' || chr(10) ||
        '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj' || chr(10) ||
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj' || chr(10) ||
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 320 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj' || chr(10) ||
        '4 0 obj<</Length ' || length(s) || '>>stream' || chr(10) || s || chr(10) || 'endstream endobj' || chr(10) ||
        '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj' || chr(10) ||
        'trailer<</Root 1 0 R>>' || chr(10) || '%%EOF', 'UTF8')
    FROM (SELECT 'BT /F1 11 Tf 12 60 Td (SYNTHETIC RECEIPT ' || replace(replace(label, '(', ''), ')', '') || ') Tj ET' AS s) x
$$;

DO $$
#variable_conflict use_variable
DECLARE
    cats       TEXT[] := ARRAY['MEALS','MEALS','MEALS','LOCAL_CAB','LOCAL_CAB','LOCAL_CAB','HOTEL','HOTEL','FLIGHT','FLIGHT','TRAIN','OTHER'];
    tier1       TEXT[] := ARRAY['Mumbai','Delhi','Bengaluru','Chennai','Kolkata','Hyderabad','Pune','Ahmedabad'];
    other_city  TEXT[] := ARRAY['Indore','Jaipur','Lucknow','Nagpur','Kochi','Bhopal','Surat','Coimbatore'];
    v_meals     TEXT[] := ARRAY['Barbeque Nation','Haldiram''s','Saravana Bhavan','Social','Chaayos','Domino''s','Udupi Grand','Paradise Biryani'];
    v_cab       TEXT[] := ARRAY['Uber','Ola','Rapido','Meru Cabs','BluSmart'];
    v_hotel     TEXT[] := ARRAY['Taj Hotels','ITC Hotels','Lemon Tree','Ginger','Novotel','Treebo','FabHotel'];
    v_flight    TEXT[] := ARRAY['IndiGo','Air India','Akasa Air','SpiceJet','Vistara'];
    v_train     TEXT[] := ARRAY['IRCTC'];
    v_other     TEXT[] := ARRAY['Amazon Business','Croma','Staples','WeWork','Office Depot'];

    head_id      BIGINT;
    auditor_ids  BIGINT[];
    pool         BIGINT[];          -- employees with a manager, excluding emp.demo
    emp_demo     BIGINT;
    colleague    BIGINT;
    mgr_demo     BIGINT;
    mgr_leave    BIGINT;
    mgr_demo_team BIGINT[];

    i INT; k INT; n INT;
    emp_id BIGINT; mgr_id BIGINT;
    st TEXT; r DOUBLE PRECISION;
    sub_at TIMESTAMPTZ; created TIMESTAMPTZ; t TIMESTAMPTZ;
    claim_id BIGINT; line_id BIGINT; rcpt_id BIGINT; batch_id BIGINT;
    policy_reject BOOLEAN; any_route BOOLEAN; any_reject BOOLEAN;
    total NUMERIC(12,2);
    cat TEXT; amt NUMERIC(12,2); d DATE; w INT; city TEXT; nights SMALLINT; vendor TEXT;
    flags TEXT[]; outcome TEXT; reason TEXT; has_receipt BOOLEAN; breach BOOLEAN;
    dup RECORD; rdata BYTEA; aud_id BIGINT;
    sample TEXT;
BEGIN
    PERFORM setseed(0.45);

    SELECT id INTO head_id   FROM employees WHERE email = 'head.demo@expenseflow.test';
    SELECT id INTO emp_demo  FROM employees WHERE email = 'emp.demo@expenseflow.test';
    SELECT id INTO colleague FROM employees WHERE email = 'colleague.demo@expenseflow.test';
    SELECT id INTO mgr_demo  FROM employees WHERE email = 'mgr.demo@expenseflow.test';
    SELECT id INTO mgr_leave FROM employees WHERE email = 'mgr.leave@expenseflow.test';
    SELECT array_agg(id ORDER BY id) INTO auditor_ids FROM employees WHERE role = 'AUDITOR';
    SELECT array_agg(id ORDER BY id) INTO pool FROM employees WHERE manager_id IS NOT NULL AND id <> emp_demo;
    SELECT array_agg(id ORDER BY id) INTO mgr_demo_team FROM employees WHERE manager_id = mgr_demo AND id <> emp_demo;

    -- 3,000 historical + 5 old ones for emp.demo + 40 current queue + stuck + mgr.demo own + colleague
    FOR i IN 1..3048 LOOP
        policy_reject := false;
        sample := 'NONE';

        IF i <= 3000 THEN
            emp_id := pool[1 + floor(random() * array_length(pool, 1))::int];
            r := random();
            st := CASE WHEN r < 0.78 THEN 'PAID' WHEN r < 0.88 THEN 'REJECTED' WHEN r < 0.95 THEN 'APPROVED'
                       WHEN r < 0.98 THEN 'NEEDS_CLARIFICATION' ELSE 'DRAFT' END;
            sub_at := now() - interval '2 days' - random() * interval '360 days';
        ELSIF i <= 3005 THEN                                   -- emp.demo history, all PAID, > 100 days old
            emp_id := emp_demo; st := 'PAID';
            sub_at := now() - interval '100 days' - random() * interval '200 days';
        ELSIF i <= 3045 THEN                                   -- current queue, last 24 h
            k := i - 3005;                                     -- 1..40
            emp_id := CASE WHEN k <= 6 AND array_length(mgr_demo_team, 1) > 0
                           THEN mgr_demo_team[1 + (k - 1) % array_length(mgr_demo_team, 1)]
                           ELSE pool[1 + floor(random() * array_length(pool, 1))::int] END;
            st := CASE WHEN k <= 25 THEN 'PENDING_MANAGER' WHEN k <= 35 THEN 'PENDING_AUDITOR' ELSE 'PENDING_HEAD' END;
            sub_at := now() - random() * interval '20 hours';
        ELSIF i = 3046 THEN                                    -- stuck claim, 3 days old, in mgr.leave's team
            SELECT id INTO emp_id FROM employees WHERE manager_id = mgr_leave ORDER BY id LIMIT 1;
            st := 'PENDING_MANAGER'; sub_at := now() - interval '3 days';
        ELSIF i = 3047 THEN                                    -- mgr.demo's own claim (approver: head) – 403 demo
            emp_id := mgr_demo; st := 'PENDING_MANAGER'; sub_at := now() - interval '2 hours';
        ELSE                                                   -- colleague.demo's claim – 404 demo
            emp_id := colleague; st := 'PENDING_MANAGER'; sub_at := now() - interval '3 hours';
        END IF;

        SELECT manager_id INTO mgr_id FROM employees WHERE id = emp_id;
        created := sub_at - random() * interval '2 days';
        IF st = 'REJECTED' AND random() < 0.5 THEN policy_reject := true; END IF;

        INSERT INTO claims (claim_number, employee_id, title, status, total_amount, sample_audit,
                            submitted_at, created_at, updated_at)
        VALUES ('EXP-' || to_char(sub_at, 'YYYY') || '-' || lpad(nextval('claim_number_seq')::text, 6, '0'),
                emp_id,
                (ARRAY['Client visit','Sales trip','Team offsite','Conference','Customer workshop','Project kickoff',
                       'Training','Site audit'])[1 + floor(random() * 8)::int]
                  || ' – ' || (ARRAY[tier1[1 + floor(random() * 8)::int], other_city[1 + floor(random() * 8)::int]])[1 + floor(random() * 2)::int],
                st, 0, 'NONE',
                CASE WHEN st = 'DRAFT' THEN NULL ELSE sub_at END, created, sub_at)
        RETURNING id INTO claim_id;

        -- lines
        n := CASE WHEN i > 3005 AND st = 'PENDING_HEAD' THEN 3 ELSE 1 + floor(random() * 5)::int END;
        total := 0; any_route := false; any_reject := false;
        FOR k IN 1..n LOOP
            cat := cats[1 + floor(random() * array_length(cats, 1))::int];
            breach := random() < 0.08;
            city := NULL; nights := NULL;

            -- weekday date in the 10 days before submit, then ~10% moved to the previous Saturday/Sunday
            d := (sub_at - (floor(random() * 10)::int || ' days')::interval)::date;
            w := extract(isodow FROM d)::int;
            IF w >= 6 THEN d := d - (w - 5); w := 5; END IF;
            IF random() < 0.10 THEN d := d - (w + CASE WHEN random() < 0.5 THEN 1 ELSE 0 END); END IF;
            IF d > (now() AT TIME ZONE 'UTC')::date THEN d := (now() AT TIME ZONE 'UTC')::date; END IF;

            CASE cat
                WHEN 'MEALS' THEN
                    amt := CASE WHEN breach THEN 1600 + random() * 1400 ELSE 150 + random() * 1100 END;
                    vendor := v_meals[1 + floor(random() * array_length(v_meals, 1))::int];
                WHEN 'LOCAL_CAB' THEN
                    amt := CASE WHEN breach THEN 2100 + random() * 1400 ELSE 120 + random() * 1700 END;
                    vendor := v_cab[1 + floor(random() * array_length(v_cab, 1))::int];
                WHEN 'HOTEL' THEN
                    nights := 1 + floor(random() * 4)::int;
                    IF random() < 0.6 THEN
                        city := tier1[1 + floor(random() * 8)::int];
                        amt := nights * CASE WHEN breach THEN 6100 + random() * 3000 ELSE 3000 + random() * 2900 END;
                    ELSE
                        city := other_city[1 + floor(random() * 8)::int];
                        amt := nights * CASE WHEN breach THEN 4100 + random() * 2000 ELSE 2000 + random() * 1900 END;
                    END IF;
                    vendor := v_hotel[1 + floor(random() * array_length(v_hotel, 1))::int];
                WHEN 'FLIGHT' THEN
                    amt := 3500 + random() * 14500;
                    vendor := v_flight[1 + floor(random() * array_length(v_flight, 1))::int];
                WHEN 'TRAIN' THEN
                    amt := 400 + random() * 3100;
                    vendor := v_train[1];
                ELSE
                    amt := 200 + random() * 4800;
                    vendor := v_other[1 + floor(random() * array_length(v_other, 1))::int];
            END CASE;

            -- current queue: first line has no policy (ROUTE), totals match the level (README R9):
            -- auditor > 25,000, head > 1,00,000
            IF i > 3005 AND st = 'PENDING_MANAGER' AND k = 1 THEN
                cat := 'FLIGHT'; vendor := 'IndiGo'; city := NULL; nights := NULL; amt := 3500 + random() * 9000;
            ELSIF i > 3005 AND i <= 3045 AND st = 'PENDING_AUDITOR' AND k = 1 THEN
                cat := 'FLIGHT'; vendor := 'Air India'; city := NULL; nights := NULL; amt := 26000 + random() * 20000;
            ELSIF i > 3005 AND i <= 3045 AND st = 'PENDING_HEAD' THEN
                cat := 'OTHER'; vendor := 'Conference booth – ' || k; city := NULL; nights := NULL; amt := 36000 + random() * 20000;
            END IF;

            -- ~5% planted duplicates in history: copy an earlier line of the same employee (R5)
            IF i <= 3005 AND random() < 0.05 THEN
                SELECT l.category, l.amount, l.expense_date, l.vendor, l.city, l.nights INTO dup
                  FROM claim_lines l JOIN claims c ON c.id = l.claim_id
                 WHERE c.employee_id = emp_id AND c.status <> 'REJECTED'
                 ORDER BY l.id DESC LIMIT 1;
                IF FOUND THEN
                    cat := dup.category; amt := dup.amount; d := dup.expense_date; vendor := dup.vendor;
                    city := dup.city; nights := dup.nights;
                END IF;
            END IF;

            amt := round(amt, 2);
            has_receipt := NOT (policy_reject AND k = 1) AND (amt > 500 OR random() < 0.6);
            rcpt_id := NULL;
            IF has_receipt THEN
                IF random() < 0.02 AND EXISTS (SELECT 1 FROM receipts) THEN   -- ~2% reused receipt bytes (R5 by hash)
                    SELECT data INTO rdata FROM receipts
                     WHERE id >= (SELECT min(id) + floor(random() * (max(id) - min(id) + 1)) FROM receipts)
                     ORDER BY id LIMIT 1;
                ELSE
                    rdata := pg_temp.seed_pdf(vendor || ' ' || amt::text || ' ' || d::text || ' C' || claim_id || '-' || k);
                END IF;
                INSERT INTO receipts (owner_id, file_name, content_type, size_bytes, sha256, data, uploaded_at)
                VALUES (emp_id, 'receipt-' || claim_id || '-' || k || '.pdf', 'application/pdf', length(rdata),
                        encode(digest(rdata, 'sha256'), 'hex'), rdata, created)
                RETURNING id INTO rcpt_id;
            END IF;

            -- flags / outcome exactly as the engine would (README 4.3), skipped for drafts
            flags := ARRAY[]::TEXT[]; outcome := NULL; reason := NULL;
            IF st <> 'DRAFT' THEN
                IF amt > 500 AND rcpt_id IS NULL THEN
                    flags := array_append(flags, 'MISSING_RECEIPT'); reason := 'Receipt required above 500 INR';
                END IF;
                IF (cat = 'MEALS' AND amt > 1500) OR (cat = 'LOCAL_CAB' AND amt > 2000)
                   OR (cat = 'HOTEL' AND amt / nights > CASE WHEN city = ANY (tier1) THEN 6000 ELSE 4000 END) THEN
                    flags := array_append(flags, 'OVER_LIMIT'); reason := coalesce(reason, 'Above policy limit');
                END IF;
                IF EXISTS (SELECT 1 FROM claim_lines l JOIN claims c ON c.id = l.claim_id
                            WHERE c.employee_id = emp_id AND c.id <> claim_id
                              AND lower(trim(l.vendor)) = lower(trim(vendor)) AND l.amount = amt AND l.expense_date = d)
                   OR (rcpt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts x
                            WHERE x.id <> rcpt_id AND x.sha256 = (SELECT sha256 FROM receipts WHERE id = rcpt_id))) THEN
                    flags := array_append(flags, 'DUPLICATE'); reason := coalesce(reason, 'Duplicate of an earlier line');
                END IF;
                IF extract(isodow FROM d) >= 6 THEN
                    flags := array_append(flags, 'WEEKEND'); reason := coalesce(reason, 'Weekend expense');
                END IF;
                IF cat IN ('FLIGHT','TRAIN','OTHER') THEN
                    flags := array_append(flags, 'NO_POLICY'); reason := coalesce(reason, 'No auto-approve policy for ' || cat);
                END IF;
                outcome := CASE WHEN 'MISSING_RECEIPT' = ANY (flags) THEN 'AUTO_REJECT'
                                WHEN cardinality(flags) > 0 THEN 'ROUTE' ELSE 'AUTO_APPROVE' END;
                any_reject := any_reject OR outcome = 'AUTO_REJECT';
                any_route  := any_route  OR outcome = 'ROUTE';
            END IF;

            INSERT INTO claim_lines (claim_id, line_no, category, expense_date, amount, vendor, city, nights,
                                     description, receipt_id, outcome, flags, reason)
            VALUES (claim_id, k, cat, d, amt, vendor, city, nights, NULL, rcpt_id, outcome, flags, reason)
            RETURNING id INTO line_id;
            total := total + amt;
        END LOOP;

        -- keep statuses consistent with the policy result and thresholds
        IF st IN ('PAID','APPROVED','NEEDS_CLARIFICATION') AND any_reject THEN st := 'REJECTED'; END IF;
        IF st = 'PENDING_AUDITOR' AND total > 100000 THEN st := 'PENDING_HEAD'; END IF;
        -- an auditor never approves their own claim (R15)
        SELECT a INTO aud_id FROM unnest(auditor_ids) a WHERE a <> emp_id ORDER BY random() LIMIT 1;
        IF st = 'REJECTED' AND any_reject THEN policy_reject := true; END IF;
        IF st = 'REJECTED' AND NOT any_reject THEN policy_reject := false; END IF;

        -- approval steps (README 4.4); each decision within 6 h (history is >= 2 days old, so never in the future)
        t := sub_at;
        IF st IN ('PAID','APPROVED') THEN
            IF any_route OR total > 5000 THEN
                t := t + random() * interval '6 hours';
                INSERT INTO approval_steps (claim_id, level, approver_id, acted_by_id, decision, comment, decided_at)
                VALUES (claim_id, 'MANAGER', mgr_id, mgr_id, 'APPROVED', NULL, t);
                IF total > 25000 THEN
                    t := t + random() * interval '6 hours';
                    INSERT INTO approval_steps (claim_id, level, approver_id, acted_by_id, decision, comment, decided_at)
                    VALUES (claim_id, 'AUDITOR', aud_id, aud_id, 'APPROVED', NULL, t);
                END IF;
                IF total > 100000 THEN
                    t := t + random() * interval '6 hours';
                    INSERT INTO approval_steps (claim_id, level, approver_id, acted_by_id, decision, comment, decided_at)
                    VALUES (claim_id, 'HEAD', head_id, head_id, 'APPROVED', NULL, t);
                END IF;
            ELSIF random() < 0.10 THEN
                sample := CASE WHEN st = 'APPROVED' AND random() < 0.3 THEN 'OPEN' ELSE 'CLEARED' END;
            END IF;
            UPDATE claims SET final_decision_at = t, sample_audit = sample WHERE id = claim_id;
        ELSIF st = 'REJECTED' AND NOT policy_reject THEN
            t := t + random() * interval '6 hours';
            INSERT INTO approval_steps (claim_id, level, approver_id, acted_by_id, decision, comment, decided_at)
            VALUES (claim_id, 'MANAGER', mgr_id, mgr_id, 'REJECTED', 'Not a business expense', t);
            UPDATE claims SET final_decision_at = t WHERE id = claim_id;
        ELSIF st = 'REJECTED' THEN
            UPDATE claims SET final_decision_at = sub_at WHERE id = claim_id;
        ELSIF st = 'NEEDS_CLARIFICATION' THEN
            t := t + random() * interval '6 hours';
            INSERT INTO approval_steps (claim_id, level, approver_id, acted_by_id, decision, comment, decided_at)
            VALUES (claim_id, 'MANAGER', mgr_id, mgr_id, 'SENT_BACK', 'Please attach the itemised bill', t);
        ELSIF st IN ('PENDING_AUDITOR','PENDING_HEAD') THEN
            INSERT INTO approval_steps (claim_id, level, approver_id, acted_by_id, decision, comment, decided_at)
            VALUES (claim_id, 'MANAGER', mgr_id, mgr_id, 'APPROVED', NULL, sub_at + interval '10 minutes');
            IF st = 'PENDING_HEAD' THEN
                INSERT INTO approval_steps (claim_id, level, approver_id, acted_by_id, decision, comment, decided_at)
                VALUES (claim_id, 'AUDITOR', aud_id, aud_id, 'APPROVED', NULL, sub_at + interval '20 minutes');
            END IF;
        END IF;

        -- PAID: one SENT batch per month of payment (created_at = month start while seeding; real times set below)
        IF st = 'PAID' THEN
            t := t + (1 + floor(random() * 5)::int) * interval '1 day';
            IF t > now() THEN t := now() - interval '1 hour'; END IF;
            batch_id := NULL;
            SELECT id INTO batch_id FROM payout_batches
             WHERE status = 'SENT' AND created_at = date_trunc('month', t) LIMIT 1;
            IF batch_id IS NULL THEN
                INSERT INTO payout_batches (batch_ref, status, claim_count, total_amount, file_name, csv_content,
                                            attempts, bank_reference, created_by, created_at, sent_at)
                VALUES ('PB-' || to_char(t, 'YYYYMMDD') || '-' || lpad(nextval('payout_batch_seq')::text, 3, '0'),
                        'SENT', 0, 0, 'seed.csv',
                        'batch_ref,claim_number,employee_code,employee_name,account_number,ifsc,amount_inr,narration' || chr(10),
                        1, 'BNK-' || upper(substr(md5(random()::text), 1, 6)), head_id,
                        date_trunc('month', t), t)
                RETURNING id INTO batch_id;
            END IF;
            UPDATE claims SET payout_batch_id = batch_id, paid_at = t WHERE id = claim_id;
        END IF;

        UPDATE claims SET total_amount = total, status = st, updated_at = greatest(t, sub_at) WHERE id = claim_id;

        INSERT INTO audit_events (actor_id, action, entity_type, entity_id, claim_id, to_status, details, created_at)
        VALUES (emp_id, 'SEEDED', 'CLAIM', claim_id, claim_id, st,
                jsonb_build_object('lines', n, 'total', total, 'source', 'V5__seed_claims'), coalesce(sub_at, created));
    END LOOP;

    -- batch files, totals and times from the claims they paid (all claims of a batch are PAID at send time)
    UPDATE payout_batches b
       SET claim_count  = s.cnt,
           total_amount = s.amt,
           created_at   = s.last_paid - interval '1 hour',
           sent_at      = s.last_paid,
           file_name    = 'PAYOUT_' || b.batch_ref || '_' || to_char(s.last_paid, 'YYYYMMDD') || '.csv',
           csv_content  = b.csv_content || s.csv
      FROM (SELECT c.payout_batch_id AS bid, count(*) AS cnt, sum(c.total_amount) AS amt, max(c.paid_at) AS last_paid,
                   string_agg(concat_ws(',', pb.batch_ref, c.claim_number, e.employee_code, e.name, e.account_number,
                                        e.ifsc, c.total_amount::text, c.claim_number || ' reimbursement'),
                              chr(10) ORDER BY c.claim_number) || chr(10) AS csv
              FROM claims c JOIN employees e ON e.id = c.employee_id JOIN payout_batches pb ON pb.id = c.payout_batch_id
             GROUP BY c.payout_batch_id) s
     WHERE s.bid = b.id;

    -- one payout time per batch: every claim in a batch is PAID when the batch was SENT
    UPDATE claims c SET paid_at = b.sent_at FROM payout_batches b WHERE c.payout_batch_id = b.id;
END $$;
