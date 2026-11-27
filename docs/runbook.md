# ExpenseFlow – Runbook

**Owner:** Prasang (DevOps/SRE) · **Hot standby on demo day:** Prasang, same commit and `.env` as the demo laptop (Dipesh).
Source of truth for behaviour: `README.md`. How the platform is built: `devops.md`.

Measured numbers are filled in from real runs only. Anything marked **TBD – measured value** has not been measured yet.

---

## 1. Start, stop, reset

| Task | Command (PowerShell, repo root) |
|---|---|
| Start everything | `docker compose up -d --build --wait` |
| Start with debug ports (5432, 8089, 9090) | `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build --wait` |
| Status (expect 2 healthy `backend` rows) | `docker compose ps` |
| Logs of all replicas | `docker compose logs -f backend` |
| Stop (keep data) | `docker compose stop` |
| Full gate before merge | `powershell -ExecutionPolicy Bypass -File scripts/check.ps1` |
| **Reset demo data (destructive)** | `powershell -ExecutionPolicy Bypass -File scripts/reset-demo.ps1 -Yes` |
| Scale backend | `docker compose up -d --scale backend=3 --no-recreate` |

| URL | What |
|---|---|
| http://localhost:8080 | App through the gateway (only public app port) |
| http://localhost:8080/api/swagger-ui.html | Swagger UI |
| http://localhost:3000 | Grafana (`admin` / `GRAFANA_ADMIN_PASSWORD`, default `change-me`) – dashboard "Hackathon – Overview" |
| http://localhost:9090 | Prometheus (dev file only) – `/alerts`, `/rules`, `/targets` |
| http://localhost:8089/__admin | WireMock mock bank (dev file only) |

Demo users: `emp.demo`, `colleague.demo`, `mgr.demo`, `mgr.leave`, `auditor.demo`, `head.demo` `@expenseflow.test`, password `Demo@123`.

## 2. Architecture in one paragraph

nginx gateway (:8080, rate limits, security headers, `X-Request-ID`) → React static files + **2 stateless Spring Boot replicas** (round-robin, failed replica skipped) → PostgreSQL 18. A one-shot `migrate` container runs Flyway before the backend starts. Payouts go to a WireMock mock bank; a retry job (every replica, `FOR UPDATE SKIP LOCKED`) resends batches the bank did not accept. Prometheus scrapes every replica (DNS discovery), the gateway (nginx exporter) and a blackbox probe; Grafana shows the dashboard.

## 3. Alerts and what to do

| Alert | Meaning | First checks | Fix |
|---|---|---|---|
| <a id="bank-down"></a>**BankPayoutFailing** (critical) | ≥ 1 payout batch is `PENDING_SEND` (bank down, slow or rejecting) | `scripts/drill.ps1 status` → batch `attempts`, `last_error`; `docker compose ps wiremock`; health inside the container (`/actuator` is not routed by the gateway): `docker compose exec backend wget -S -qO- http://127.0.0.1:8080/actuator/health` | Bring the bank back (`docker compose start wiremock`). No action on the app: the retry job resends within `PAYOUT_RETRY_INTERVAL_MS` (30 s; 10 s on the demo laptop). HEAD can press **Retry now**. Claims stay `IN_PAYOUT` until the bank accepts (R12) |
| **BankCallErrors** (critical) | A bank call failed in the last minute | as above | as above |
| <a id="oldest-pending-approval"></a>**OldestPendingApprovalTooOld** (warning) | A claim has waited > 48 h for a decision | Grafana "Oldest pending approval"; HEAD dashboard exceptions table | Nudge the approver or set up a delegation. **Expected to fire after a reset**: the seed contains one claim stuck for 3 days |
| **BackendReplicaDown** (warning) | One replica not scraped for 10 s | `docker compose ps backend`; `docker compose logs backend` | Usually self-heals (`restart: unless-stopped`). If it loops: check logs for DB or schema errors |
| **BackendDown** (critical) | No replica up | as above, plus `docker compose ps postgres migrate` | Postgres healthy? `migrate` exited 0? Schema validation error → entity and migration differ |
| **AppUnreachable** (critical) | Blackbox probe through the gateway fails | `curl.exe -i localhost:8080/healthz`; `docker compose ps gateway frontend` | Restart gateway: `docker compose restart gateway` |
| **HighErrorRate** (warning) | > 5% 5xx for 1 min | Grafana "Backend 5xx ratio", logs filtered by `correlationId` | Roll back (`TAG=<previous sha>`, `docker compose up -d`) if caused by a deploy |
| **HighLatencyP95** (warning) | API p95 > 1 s for 2 min | Grafana "API p95 by endpoint" | Check DB load, JVM heap panel; scale `--scale backend=3` |
| **SLOErrorBudgetFastBurn** (critical) | 5xx burning the 99.5% budget 14.4× too fast | same as HighErrorRate | same |

Finding one request: every response has `X-Request-ID`; the same id is the `correlationId` in backend JSON logs and in `audit_events.correlation_id`:
`docker compose logs backend | Select-String <id>`.

## 4. SLOs (1 h window for the hackathon, 30 days in production)

| SLO | Target | Measured |
|---|---|---|
| API availability (non-5xx) | 99.5% | 0% errors in all k6 runs (8,659 + 206,099 requests) |
| API latency (`/api`, < 500 ms) | 95% | k6 50 VUs on the dev laptop: p95 982 ms – **target not met** on this machine (sec 8) |
| Approval freshness | oldest pending < 48 h | fires after reset by design (seeded stuck claim) |
| Payout delivery | batches sent within 5 min (outside drills) | TBD – measured value |

Error budget remaining = `1 - ((1 - availability) / (1 - 0.995))`. PromQL in `devops.md` sec 9.

## 5. Drills

### Drill 1 – bank outage (live in the demo)
Before the demo set `PAYOUT_RETRY_INTERVAL_MS=10000` in `.env` and restart the backend.

| Step | Who / command | Expected |
|---|---|---|
| 0 | baseline | Grafana: payout batches waiting = 0; `BankPayoutFailing` inactive |
| 1 | `scripts/drill.ps1 bank-stop` | `docker compose exec backend wget -S -qO- http://127.0.0.1:8080/actuator/health` answers 503 with `bank: DOWN`; app keeps working; `docker compose ps` still shows the backend **healthy** (liveness only) |
| 2 | HEAD creates a payout batch | UI "Waiting for bank", claims `IN_PAYOUT`, no error page |
| 3 | Grafana / Prometheus | "Payout batches waiting" = 1 (red); `BankPayoutFailing` firing within ~10–20 s |
| 4 | `scripts/drill.ps1 bank-start` | retry job sends; batch `SENT`; claims `PAID` |
| 5 | Grafana + claim timeline | panel back to 0, alert resolved |

Measured 2026-11-27 (laptop, default 30 s interval, 2 replicas): bank-start → batch `SENT`, claims `PAID` in **28 s** (17 s on a re-run after the payout rewrite); the batch was sent exactly once (5 failed attempts spread over both replicas, then 1 `PAYOUT_SENT`). Time from batch creation to `BankPayoutFailing` firing was not measured precisely (< 97 s); re-time it in rehearsal.

### Drill 2 – replica crash under load
`$env:TARGET="http://gateway:8080"; $env:VUS=10; docker compose --profile loadtest run --rm k6` and, in a second window, `scripts/drill.ps1 kill-replica`.
Expected: `BackendReplicaDown` fires, traffic moves to the other replica, Docker restarts the killed one.
Measured 2026-11-27 (10 VUs through the gateway): 206,099 requests, **0 failed** (no 5xx / connection errors); Docker restarted the killed replica in ~3 s. Caveat: most requests were 429s from the per-IP rate limit, so only ~20 req/s actually reached the backends during the crash.

### Drill 3 – backup and restore (X5)
`scripts/backup-db.ps1` → delete a few draft claims → `scripts/restore-db.ps1 backups/<file>.dump` → counts match.
Measured 2026-11-27: backup 3.6 s (4.1 MB); **RTO 67.4 s** (stop backend → `pg_restore` → both replicas healthy); claim counts matched; audit triggers and Flyway history restored. RPO = time since the last backup.

## 6. Deploy, rollback, rolling restart

- **Release build:** `$env:TAG = git rev-parse --short HEAD; docker compose build` – images are kept per SHA (`expenseflow/backend:<sha>`).
- **Rollback:** `$env:TAG = "<previous sha>"; docker compose up -d --no-build` (`--no-build` matters: with `build:` in the file Compose would otherwise rebuild the *current* source under the old tag). Only works for SHAs that were built on this machine.
- **Rolling restart without downtime:** `scripts/rolling-restart.ps1` (one replica at a time, waits for healthy; graceful shutdown drains 20 s).
- Never edit an applied Flyway migration; add `V6__...`. If a migration fails, `migrate` exits non-zero and the backend does not start (safe by design): `docker compose logs migrate`.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `up --wait` fails | `docker compose ps -a`, then `docker compose logs <service>` |
| `failed to resolve reference ... HTTP response to HTTPS client` | Docker Desktop proxy hiccup – run the command again (scripts retry automatically) |
| Backend restarts, "Schema-validation" in logs | Entity and migration differ; the entity follows the migration |
| `migrate` exited 1 | SQL error in a new migration – fix it in a new file |
| Gateway 502 | No healthy backend replica |
| Only one replica gets traffic | `docker compose restart gateway` |
| Grafana numbers doubled | Gauge panel uses `sum()` instead of `max()` |
| Login always 401 for seeded users | Seed hash not BCrypt – V2 uses a Spring-compatible `$2a$10$` hash |
| 429 in tests | Expected: login is limited to 30/min per IP, API to 20 req/s (burst 40) |
| Thousands of pending claims for `emp.demo` / in `mgr.demo`'s queue | A k6 run created them (writes are real). `scripts/reset-demo.ps1 -Yes` before a demo |
| Laptop out of memory | `BACKEND_REPLICAS=1` in `.env` |
| Postgres exits at start | Old volume from another major version: `scripts/reset-demo.ps1` |

## 8. Performance (measured, reported honestly)

| Run (2026-11-27, Windows laptop, 12 cores, Docker Desktop) | Result |
|---|---|
| k6, 50 VUs, 1 min, straight to the 2 backend replicas (`cpus: 1.0` each), after warm-up | 8,659 requests, 100.8 req/s, **0% errors**, p95 982 ms (list 875, detail 790, queue 1,008, create+submit 1,017) – README target p95 < 500 ms **not met** |
| Same with `BACKEND_CPUS=2.0` | p95 1,303 ms – no improvement: the laptop itself (k6 + DB + Docker VM + IDE on one machine) is the limit, not the container CPU cap |
| Fix applied | N+1 on list endpoints removed (`hibernate.default_batch_fetch_size: 64`): throughput 89 → 101 req/s at 50 VUs |

Next steps if the target matters for the demo: run k6 from a second machine, profile the queue endpoint (per-row `waitingHours` query), add projections for list endpoints.
