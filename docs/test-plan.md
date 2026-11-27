# ExpenseFlow – Test plan

Scope and rules come from `README.md` (sections 4, 5, 9, 12). Results are recorded only from real runs
(`scripts/check.ps1`, `backend/target/surefire-reports`, `evidence/`). **TBD – measured value** = not run yet.

## 1. Levels

| Level | What | Where | How to run | Owner |
|---|---|---|---|---|
| Unit – policy engine | R1–R6, R8, R16 with every boundary (1,500 / 1,500.01; hotel 6,000 / 6,000.01 tier-1, 4,000 / 4,000.01 other; cab 2,000 / 2,000.01; receipt 500 / 500.01; auto-approve 5,000 / 5,000.01), duplicates by fields / hash / within claim, weekend, NO_POLICY, precedence, golden demo claim | `backend/src/test/.../PolicyEngineTest.java` | `scripts/check.ps1` (or `mvn test`) | Prasang |
| Unit – state machine | every allowed transition in README sec 5 and every other pair → 409 | `StatusFlowTest.java` | same | Prasang |
| Unit – approval chain | thresholds 25,000 / 25,000.01 and 1,00,000 / 1,00,000.01, HEAD approve, A11 (HEAD's own claim ends at AUDITOR), R15 self-approval 403, wrong role 403, R10 delegation in/out of dates, comment/reason required, bulk approve per-claim results | `ApprovalServiceTest.java` | same | Prasang |
| Integration – Spring context | Flyway V1–V5 on a fresh PostgreSQL 18 (Testcontainers), `ddl-auto=validate` (entities match schema) | `ExpenseFlowApplicationTests` | same | Prasang |
| Integration – through the gateway | gateway headers, `/actuator` hidden, SPA fallback, Swagger, 401/403/404, R13, R15, create → idempotent submit → approve → payout → PAID, CSV, audit timeline, rate limit 429 | `tests/integration.sh` | `bash tests/integration.sh` (stack running) | Prasang |
| E2E (UI) | E2E-01…10 below, 375 px project | Playwright (`frontend/`) | Mohit | Mohit |
| Performance | 70/30 read/write mix, unique Idempotency-Keys, p95 < 500 ms, errors < 1% | `loadtest/load.js` | `docker compose --profile loadtest run --rm k6` | Prasang |
| Security | gitleaks, Trivy fs + images, SBOM; Claude checklist incl. "ways to bypass approvals" | `scripts/scan.ps1` | same | Dipesh, Prasang |
| Resilience | drill 1 bank outage, drill 2 replica crash, drill 3 backup/restore | `scripts/drill.ps1`, `backup-db.ps1`, `restore-db.ps1` | runbook sec 5 | Prasang |

## 2. E2E cases (README sec 12)

| ID | Case | Automated | Result |
|---|---|---|---|
| E2E-01 | login per role + correct menu | – | TBD |
| E2E-02 | create draft with receipts, reopen, edit | – | TBD |
| E2E-03 | double-click submit → one claim | first | TBD |
| E2E-04 | missing receipt above 500 → auto-rejected with reason | – | TBD |
| E2E-05 | over-limit hotel routed, manager approves ≤ 25,000 → APPROVED | first | TBD |
| E2E-06 | claim > 25,000 → manager → auditor bulk approve | first | TBD |
| E2E-07 | send back → employee edits → resubmit → routed again | – | TBD |
| E2E-08 | delegate approves for manager on leave | – | TBD |
| E2E-09 | employee opens colleague's claim → not found; manager approves own → blocked | first | TBD (API level covered by `integration.sh`) |
| E2E-10 | head payout with bank down → waiting → bank up → PAID | first | TBD (drill 1) |

## 3. Test data

Flyway seeds (synthetic only): V2 config + demo users, V4 150 employees, V5 3,000 historical claims with planted
duplicates / reused receipt hashes / limit breaches / weekend lines, ~40 pending in the last 24 h, 1 stuck claim (3 days),
the `mgr.leave` → `mgr.demo` delegation (today ± 3 days). Reset: `scripts/reset-demo.ps1 -Yes`.
Demo-safety: `emp.demo` only has claims older than 100 days, so the golden-flow claim is not affected by R1/R5.

## 4. Entry / exit criteria

- **Entry:** stack healthy (`docker compose ps`: 2 backend replicas), seed counts as in README sec 11.
- **Exit (per slice, README sec 16):** unit + integration tests for its rules pass, `scripts/check.ps1` ALL PASS, audit rows correct.
- **Release:** all of the above + `scripts/scan.ps1` clean + k6 thresholds met (or deviations reported honestly).

## 5. Results

| Run | Date | Result | Evidence |
|---|---|---|---|
| Backend unit + Testcontainers context (JDK 25) | 2026-11-27 | **157 / 157 passed** (policy 33, state machine 100, approval 15, visibility/receipt 8, context 1) | `backend/target/surefire-reports` |
| `tests/integration.sh` (stack, 2 replicas) | 2026-11-27 | **60 / 60 passed** (incl. edit, stale version 409, validation errors[], page=-1 400, duplicate payout ids 400, delegation visibility, HEAD queue) | console output |
| Payout race (2 parallel creates, same claim) | 2026-11-27 | 201 + 409, claim in exactly one batch, bank called once per batch | manual script |
| k6 backend, 50 VUs, 1 min | 2026-11-27 | 0% errors, 100.8 req/s, p95 982 ms – p95 < 500 ms **not met** on the dev laptop | `evidence/k6-backend.json` |
| k6 gateway, 10 VUs + replica crash (drill 2) | 2026-11-27 | 206,099 requests, 0 failed (mostly 429 by design) | `evidence/k6-replica-drill.json` |
| Drill 1 bank outage | 2026-11-27 | batch PENDING_SEND → SENT 28 s after bank-start, sent once, claims PAID | runbook sec 5 |
| Drill 3 backup/restore | 2026-11-27 | counts match, RTO 67.4 s | runbook sec 5 |
| Security scan | 2026-11-27 | gitleaks clean (2 reviewed false positives allow-listed), Trivy fs 0, images backend/frontend/gateway 0 fixable HIGH/CRITICAL, 3 SBOMs | `evidence/security/<ts>/` |
