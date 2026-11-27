# Defect log – ExpenseFlow (Team 45)

Real defects found on 2026-11-27 by the self-review, the independent agent review, the live tests and the dev merge.
Fix commit `78dd33c` = "chore: wip before dev merge" (pushed to `dev`). "uncommitted" = fixed in the working tree, not committed yet.

| ID | Title | Severity | Found by | Story | Status | Fix commit |
|---|---|---|---|---|---|---|
| DEF-01 | Flyway did not run on Spring Boot 4 (flyway-core without the Boot starter) | Critical | Self-review (stack up) | ST-12 | Fixed | 78dd33c |
| DEF-02 | Receipt upload: `@Lob` maps to OID, column is BYTEA – schema validation fails | Critical | Self-review (Testcontainers) | ST-02 | Fixed | 78dd33c |
| DEF-03 | Missing/invalid token returned 403 instead of 401 (FR-AUTH-3) | Major | Integration test | ST-01 | Fixed | 78dd33c |
| DEF-04 | Payout: double click / two parallel creates could pay the same claim twice | Critical | Independent agent review | ST-09 | Fixed | 78dd33c |
| DEF-05 | Payout: duplicate claim ids in one request accepted | Major | Independent agent review | ST-09 | Fixed | 78dd33c |
| DEF-06 | Every claim edit (PUT) failed with 409 – UNIQUE(claim_id,line_no) hit before old lines deleted | Critical | Independent agent review, confirmed live | ST-05 | Fixed | 78dd33c |
| DEF-07 | scripts/check.ps1 reported PASS when tests failed | Major | Independent agent review, confirmed | ST-12 | Fixed | 78dd33c |
| DEF-08 | Bank call had no read timeout (FR-PAY-3, 3 s) | Major | Independent agent review | ST-09 | Fixed | 78dd33c |
| DEF-09 | Auditor could resolve the sample audit on their own claim (R15) | Major | Independent agent review | ST-07 | Fixed | 78dd33c |
| DEF-10 | Sample audit predictable from the claim number (R11) | Major | Independent agent review | ST-03 | Fixed | 78dd33c |
| DEF-11 | Delegation to an EMPLOYEE allowed; delegate action returned 404 instead of 403 (R10) | Major | Independent agent review | ST-06 | Fixed | 78dd33c |
| DEF-12 | HEAD / AUDITOR queues missed claims of their direct reports at MANAGER level | Major | Independent agent review | ST-08 | Fixed | 78dd33c |
| DEF-13 | Error responses without correlation id / inconsistent ProblemDetail | Minor | Independent agent review | ST-11 | Fixed | 78dd33c |
| DEF-14 | `?page=-1` returned 500 | Minor | Independent agent review | ST-04 | Fixed | 78dd33c |
| DEF-15 | /v3/api-docs returned 500 (springdoc 2.x on Spring Framework 7) | Major | Self-review | ST-01 | Fixed | 78dd33c |
| DEF-16 | N+1 queries on list endpoints | Major | Self-review (k6) | ST-04 | Fixed | 78dd33c |
| DEF-17 | BankCallErrors alert could never fire (label mismatch) | Major | Self-review (drill 1) | ST-12 | Fixed | 78dd33c |
| DEF-18 | HighLatencyP95 alert fired on near-zero traffic | Minor | Self-review | ST-12 | Fixed | 78dd33c |
| DEF-19 | Hotel per-night check rounded (amount/nights) instead of amount > limit x nights | Minor | Independent agent review | ST-03 | Fixed | 78dd33c |
| DEF-20 | Idempotent replay changed numbers (420.00 -> 420.0) | Minor | Integration test | ST-03 | Fixed | 78dd33c |
| DEF-21 | Gateway and backend images: 68 HIGH/CRITICAL CVEs (nginx base) | Major | Trivy | ST-12 | Fixed | 78dd33c |
| DEF-22 | Test base class stopped Postgres after the first test class (`@Testcontainers` + cached context) – 29 test errors | Major | Backend test run after dev merge | ST-12 | Fixed | uncommitted |
| DEF-23 | Security/Auth tests expected 403 for missing/invalid token; README FR-AUTH-3 says 401 | Minor | Backend test run after dev merge | ST-01 | Fixed | uncommitted |
| DEF-24 | PolicyEngineTest fixture gave every receipt the same SHA-256 – R5 duplicate flag broke R16 boundary test | Minor | Backend test run after dev merge | ST-03 | Fixed | uncommitted |
| DEF-25 | MockMvc tests did not register CorrelationIdFilter – X-Request-ID test failed | Minor | Backend test run after dev merge | ST-11 | Fixed | uncommitted |
| DEF-26 | p95 latency 982 ms at 50 VUs; target < 500 ms | Major | k6 load test | ST-03 | Open | – |
| DEF-27 | Dashboard summary 2.7–3.4 s at ~11k claims (in-memory aggregation); target < 1 s at 3k | Major | Independent agent review | ST-10 | Open | – |
| DEF-28 | DB password passed as env var, not a Docker secret (NFR-SEC-5) | Minor | Self-review | ST-12 | Open | – |
