# ExpenseFlow – DevOps, data and SRE guide

**Owner: Prasang** · Lives at `docs/devops.md` · Companion to `README.md` (sections 9–11).
The README says *what*; this file says *exactly how* for Docker, load balancing, database, mock bank, monitoring, SLOs, CI/CD, backups, scripts and drills. If this file and the README disagree, the README wins – raise it in team chat.

**Priority labels:** **GOLD** = must have for the demo · **SILVER** = extra points, do after GOLD is green (T+125) · **STRETCH** = only if everything else is done.

---

## 1. Demo-breakers to get right first (GOLD)

| # | Trap | Fix |
|---|---|---|
| 1 | Docker healthcheck on `/actuator/health` turns the backend **unhealthy when the mock bank is down** (bank health indicator is part of overall health) | Backend `HEALTHCHECK` uses `/actuator/health/liveness`. Bank health shows only in `/actuator/health` and Grafana |
| 2 | Backend `depends_on: wiremock` stops the app starting when the bank is down | Backend depends on **postgres only**. The bank is optional at runtime |
| 3 | Alert takes 1–2 min to fire, but the drill slot in the demo is 45 s | Prometheus `scrape_interval` and `evaluation_interval` **5s**; bank alert `for: 0s` → fires in about 10–20 s |
| 4 | Postgres 18 refuses to start with the template's volume path | Volume at `/var/lib/postgresql` (not `/var/lib/postgresql/data`) |
| 5 | `integration.sh` fails in Git Bash with `\r` errors | `.gitattributes`: `*.sh text eol=lf` |
| 6 | WireMock crashes under the template's `read_only` hardening | Don't apply the `x-hardened` anchor to wiremock (or add `tmpfs: [/tmp, /home/wiremock]`) |
| 7 | With 2 backend replicas the payout **retry job runs on both** and could send a batch twice | Job picks batches with `SELECT … FOR UPDATE SKIP LOCKED` (section 6.4). No extra library |
| 8 | With 2 replicas, Prometheus scraping `backend:8080` sees only one replica, and DB-based gauges are reported twice | Prometheus `dns_sd_configs` for `backend`; PromQL uses `max()` for gauges and `sum()` for counters (section 8) |

---

## 2. Extra-points plan (what we add beyond the brief)

| # | Addition | Why judges care | Effort | Tier | When |
|---|---|---|---|---|---|
| X1 | **Load balancing: 2 backend replicas behind the nginx gateway** | Scalability, high availability, zero-downtime restarts | 10 min | SILVER (config at skeleton time) | T+15–50 |
| X2 | **Replica crash drill**: kill one replica under load, traffic continues, Docker restarts it | Self-healing shown live or as evidence | 5 min | SILVER | T+140–155 |
| X3 | **SLOs + error budget + burn-rate alert** in Grafana | Real SRE practice, not just dashboards | 15 min | SILVER | T+125–140 |
| X4 | **Synthetic monitoring** (blackbox exporter probes the app every 5 s) | Uptime from the user's side | 10 min | SILVER | T+125–140 |
| X5 | **Database backup and restore scripts** with measured RTO | Disaster recovery in the runbook | 10 min | SILVER | T+140–155 |
| X6 | **Supply chain: SBOM, Dependabot, secrets scan** | Security beyond the brief's dependency check | 10 min | SILVER | T+70 (CI) |
| X7 | **Release pipeline**: tag `v*` → build, SBOM, manual approval gate, smoke test | Real CD with governance | 15 min | SILVER | T+155 |
| X8 | **Rolling restart script** + k6 proof of zero failed requests | Zero-downtime deployment | 10 min | SILVER | T+155 |
| X9 | **Alert notifications** (Alertmanager → webhook receiver) | Alerts reach someone, with runbook links | 10 min | STRETCH | if time |
| X10 | **Postgres exporter** (connections, DB size, slow queries) | Database observability | 10 min | STRETCH | if time |
| X11 | **Scale test**: k6 with 1 vs 2 replicas, compare throughput | Evidence that scaling works | 10 min | STRETCH | if time |
| X12 | Centralised logs (Loki) / tracing (OpenTelemetry → Tempo) | Correlation-ID search, request traces | 30–40 min each | STRETCH | only if all else done |

**Not doing, on purpose:** Kubernetes/Helm, service mesh, multi-region, Kafka. They add risk without changing what the judges can see working in 4 hours. Talking point if asked: *"Our Compose design maps 1:1 to Kubernetes: replicas = Deployment, gateway = Ingress, liveness/readiness probes are already split, config is env vars, secrets are files."*

---

## 3. Images (pull before you need them)

```powershell
# GOLD
docker pull postgres:18-alpine
docker pull maven:3.9.16-eclipse-temurin-25-alpine
docker pull eclipse-temurin:25-jre-alpine
docker pull node:26-alpine
docker pull nginxinc/nginx-unprivileged:1.27-alpine
docker pull wiremock/wiremock:latest        # then pin the exact version you got in compose
docker pull prom/prometheus:v2.55.1
docker pull grafana/grafana:11.3.0
docker pull nginx/nginx-prometheus-exporter:1.3.0
docker pull grafana/k6:0.54.0
docker pull aquasec/trivy:0.57.1
docker pull zricethezav/gitleaks:latest
# SILVER / STRETCH (pin the versions you get)
docker pull prom/blackbox-exporter:latest
docker pull prom/alertmanager:latest
docker pull quay.io/prometheuscommunity/postgres-exporter:latest
```

---

## 4. Compose topology

| Service | Image | Networks | Host port | Healthcheck | Depends on | Tier |
|---|---|---|---|---|---|---|
| gateway | build `./gateway` | edge, app | **8080** | `wget /healthz` | frontend, backend healthy | GOLD |
| frontend | build `./frontend` | app | – | `wget /` | – | GOLD |
| backend × **2** | build `./backend` | app, data | – | `wget /actuator/health/liveness`, start-period 60s | postgres healthy | GOLD (replicas: SILVER) |
| postgres | `postgres:18-alpine` | data | dev file: 5432 | `pg_isready -U app -d app` | – | GOLD |
| wiremock | `wiremock/wiremock:<pinned>` | app | dev file: 8089 | `curl -f localhost:8080/__admin/health` (drop if no curl in image) | – | GOLD |
| prometheus | `prom/prometheus:v2.55.1` | app, monitoring | dev file: 9090 | `wget /-/ready` | – | GOLD |
| grafana | `grafana/grafana:11.3.0` | monitoring | **3000** | – | prometheus healthy | GOLD |
| nginx-exporter | `nginx/nginx-prometheus-exporter:1.3.0` | app | – | – | gateway healthy | GOLD |
| k6 | `grafana/k6:0.54.0` (profile `loadtest`) | app | – | – | on demand | GOLD |
| blackbox | `prom/blackbox-exporter` | app | – | – | gateway | SILVER |
| alertmanager | `prom/alertmanager` | monitoring | dev file: 9093 | – | – | STRETCH |
| notifier | `wiremock/wiremock` (2nd instance, alert webhook sink) | monitoring | dev file: 8090 | – | – | STRETCH |
| postgres-exporter | `postgres-exporter` | data, app | – | – | postgres healthy | STRETCH |

Files: `docker-compose.yml` (**everything**: app + monitoring, so a plain `docker compose up` starts the complete stack; k6 is behind the `loadtest` profile) · `docker-compose.dev.yml` (opens 5432, 8089, 9090 by also joining `edge`; internal networks can't publish ports). A one-shot `migrate` service (Flyway CLI) runs the migrations before the backend starts.

Commands (PowerShell):

```powershell
docker compose up -d --build --wait                                                                # full stack
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres migrate wiremock    # Dipesh local dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build --wait              # full + debug ports
docker compose ps                                                                                  # health (2 backend rows)
docker compose logs -f backend                                                                     # logs of all replicas
docker compose up -d --scale backend=3 --no-recreate                                               # scale out
docker compose down -v                                                                             # wipe data (re-seeds on next up)
```

---

## 5. Load balancing and high availability (X1, SILVER)

**Why it works without code changes:** the backend is stateless – JWT auth (no server session), receipts in PostgreSQL (ADR-003), idempotency keys and optimistic locking in the database. Any replica can serve any request.

**Compose (backend service):**

```yaml
backend:
  # no container_name and no host ports, so it can scale
  deploy:
    replicas: ${BACKEND_REPLICAS:-2}
    resources:
      limits: { cpus: "1.0", memory: 768M }
  restart: unless-stopped
```

**Gateway (`gateway/gateway.conf`)** – Docker DNS returns one IP per replica; nginx round-robins across them and skips a failing one:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;          # Docker's DNS, re-resolve every 10 s

upstream backend_upstream {
    zone backend_upstream 64k;
    server backend:8080 resolve max_fails=2 fail_timeout=10s;   # 'resolve' needs nginx >= 1.27.3
    keepalive 32;
}
# already in the template: proxy_next_upstream error timeout; proxy_connect_timeout 5s;
```

If the gateway fails to start with an error on `resolve`, the image is older than 1.27.3: remove `zone` and `resolve`, and restart the gateway after any scale change (`docker compose restart gateway`).

**Behaviour to expect:**

| Event | What happens |
|---|---|
| One replica crashes | nginx marks it failed after 2 errors, sends traffic to the other; Docker restarts the crashed one (`restart: unless-stopped`); it rejoins when healthy |
| Rolling restart | Spring `server.shutdown=graceful` drains in-flight requests; new requests go to the other replica |
| Scale to 3 | `--scale backend=3`; nginx picks up the new IP within 10 s; Prometheus discovers it within 10 s |
| Laptop RAM is tight | `BACKEND_REPLICAS=1` in `.env` – everything else still works |

Each replica adds about 0.8 GB RAM. Check the demo laptop with the full stack running before demo day.

---

## 6. Environment, secrets, backend config, database

### 6.1 `.env.example`

```dotenv
GATEWAY_PORT=8080
GRAFANA_PORT=3000
GRAFANA_ADMIN_PASSWORD=change-me
POSTGRES_DB=app
POSTGRES_USER=app
BACKEND_REPLICAS=2
TAG=local
JWT_SECRET=dev-only-change-me-32-bytes-minimum-0001
JWT_TTL_MINUTES=60
BANK_TIMEOUT_MS=3000
PAYOUT_RETRY_INTERVAL_MS=30000
TZ=UTC
```

- DB password: `secrets/db_password.txt` (value `app` for dev, created by `check.ps1`), mounted as Docker secret `db_password`, read by Spring via `spring.config.import=optional:configtree:/run/secrets/`.
- Real JWT secret for the demo laptop: `[Convert]::ToBase64String((1..48 | % { Get-Random -Max 256 }))`.
- Never commit `.env` or `secrets/*.txt`. CI runs gitleaks as proof.
- Images are tagged with the Git short SHA in CI (`TAG=$(git rev-parse --short HEAD)`); rollback = set `TAG` to the previous SHA and `up -d`.

### 6.2 Backend operational config (Dipesh owns the file; values agreed here)

```properties
server.port=8080
server.shutdown=graceful
spring.lifecycle.timeout-per-shutdown-phase=20s
server.forward-headers-strategy=native
spring.jpa.hibernate.ddl-auto=validate
spring.jpa.open-in-view=false
spring.flyway.enabled=true
spring.servlet.multipart.max-file-size=5MB
spring.servlet.multipart.max-request-size=6MB
spring.config.import=optional:configtree:/run/secrets/
spring.datasource.url=${SPRING_DATASOURCE_URL:jdbc:postgresql://localhost:5432/app}
spring.datasource.username=${SPRING_DATASOURCE_USERNAME:app}
spring.datasource.password=${db_password:app}
spring.datasource.hikari.maximum-pool-size=10
management.endpoints.web.exposure.include=health,info,prometheus
management.endpoint.health.probes.enabled=true
management.endpoint.health.show-details=always
management.endpoint.health.group.readiness.include=readinessState,db
management.metrics.tags.application=backend
management.metrics.distribution.percentiles-histogram.http.server.requests=true
management.metrics.distribution.slo.http.server.requests=100ms,500ms,1s
management.metrics.distribution.percentiles-histogram.expenseflow.bank.call=true
logging.structured.format.console=ecs
app.bank.url=${EXTERNAL_SERVICE_URL:http://localhost:8089}
app.bank.timeout-ms=${BANK_TIMEOUT_MS:3000}
app.payout.retry-interval-ms=${PAYOUT_RETRY_INTERVAL_MS:30000}
app.jwt.secret=${JWT_SECRET:dev-only-change-me-32-bytes-minimum-0001}
app.jwt.ttl-minutes=${JWT_TTL_MINUTES:60}
```

- JVM: `JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -Duser.timezone=UTC"`.
- `slo=100ms,500ms,1s` guarantees exact histogram buckets for the latency SLO (section 9).
- Health: a `bank` `HealthIndicator` calls `GET {bank.url}/bank/health` (1 s timeout). It appears in `/actuator/health` but **not** in liveness or readiness.
- Boot 4 check: `pom.xml` must contain the Flyway starter **and** `flyway-database-postgresql`; if migrations don't run at startup, this is the cause.
- Micrometer naming → Prometheus: `expenseflow.pending.claims` → `expenseflow_pending_claims`, timer `expenseflow.bank.call` → `expenseflow_bank_call_seconds_*`, counter `expenseflow.policy.outcomes` → `expenseflow_policy_outcomes_total`. Use exactly the names in README 9.4.

### 6.3 Database (Flyway, PostgreSQL 18)

Location: `backend/src/main/resources/db/migration/`. Never edit an applied migration; add `V4__...`.

| File | Contents |
|---|---|
| `V1__schema.sql` | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` all 14 tables from README section 6, CHECK constraints for enums, FKs, indexes, `claim_number_seq`, audit trigger (below), `next_attempt_at` on `payout_batches` |
| `V2__seed_config_and_users.sql` | `policy_rules`, `app_settings`, `city_tiers`, 8 departments, 150 employees + demo users, the delegation `mgr.leave` → `mgr.demo` (today ± 3 days) |
| `V3__seed_claims.sql` | 3,000 historical claims + lines + placeholder receipts + steps + one `SEEDED` audit event each; ~40 current pending; 1 stuck claim 3 days old |

**Append-only audit trigger (V1):**

```sql
CREATE FUNCTION audit_events_block_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$;
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_block_change();
```

**Passwords in seed (V2)** – one BCrypt hash computed once and reused (Spring's `BCryptPasswordEncoder` accepts pgcrypto's `$2a$` hashes):

```sql
WITH h AS (SELECT crypt('Demo@123', gen_salt('bf', 10)) AS hash)
INSERT INTO employees (employee_code, name, email, password_hash, role, department_id, manager_id, account_number, ifsc)
SELECT ..., (SELECT hash FROM h), ...;
```

**Seed rules (V3):** `SELECT setseed(0.45);` first (same data on every reset) · dates relative to `now()` · planted duplicates by copying lines (same employee, vendor, amount, date) and by inserting receipts with identical bytes (`digest(data, 'sha256')`) · placeholder receipt bytes only · current queue submitted in the last 24 h except the one stuck claim (3 days) · bank accounts 12 random digits, IFSC like `HDFC0001234`, all synthetic.

Checks:

```powershell
docker compose exec postgres psql -U app -d app -c "select status, count(*) from claims group by 1 order by 1;"
docker compose exec postgres psql -U app -d app -c "update audit_events set action='X' where id=1;"   # must fail: append-only
```

### 6.4 Safe background job with replicas (Dipesh, GOLD because replicas are on)

The 30 s payout retry job runs on every replica. Each run claims work with a row lock so two replicas never send the same batch:

```sql
-- inside one @Transactional method
SELECT * FROM payout_batches
WHERE status = 'PENDING_SEND' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
ORDER BY created_at
LIMIT 5
FOR UPDATE SKIP LOCKED;
```

Send each batch; on success set `SENT`, claims `PAID`; on failure `attempts++`, `last_error`, `next_attempt_at = now() + 30 s`. The immediate send after "create batch" uses the same method, so it is covered too. The mock bank also receives `X-Batch-Ref` – a real bank would de-duplicate on it.

---

## 7. Mock bank (WireMock)

Folder `wiremock/mappings/` (mounted to `/home/wiremock/mappings`).

`bank-health.json`:

```json
{ "request": { "method": "GET", "url": "/bank/health" },
  "response": { "status": 200, "jsonBody": { "status": "UP" }, "headers": { "Content-Type": "application/json" } } }
```

`bank-payouts.json`:

```json
{ "request": { "method": "POST", "url": "/bank/payouts",
               "headers": { "X-Batch-Ref": { "matches": "PB-\\d{8}-\\d{3}" }, "Content-Type": { "contains": "text/csv" } },
               "bodyPatterns": [ { "contains": "batch_ref,claim_number" } ] },
  "response": { "status": 202, "headers": { "Content-Type": "application/json" },
                "jsonBody": { "bankReference": "BNK-{{randomValue length=6 type='ALPHANUMERIC' uppercase=true}}",
                              "status": "ACCEPTED", "batchRef": "{{request.headers.X-Batch-Ref}}" },
                "transformers": ["response-template"] } }
```

Anything else → WireMock's default 404, which the backend treats as a failed send.

| Failure mode | How | Use |
|---|---|---|
| Bank down | `docker compose stop wiremock` / `docker compose start wiremock` (Compose names the container `<project>-wiremock-1`, so plain `docker stop wiremock` fails unless `container_name` is set) | **Live demo** |
| Bank slow (timeout) | `POST localhost:8089/__admin/mappings` with `"fixedDelayMilliseconds": 5000`, `"priority": 1` | Integration test / runbook |
| Bank error | same, `"status": 503` or `"fault": "CONNECTION_RESET_BY_PEER"` | Integration test |
| Reset | `POST localhost:8089/__admin/mappings/reset` | After a fault test |

---

## 8. Monitoring

### 8.1 Prometheus (`monitoring/prometheus/prometheus.yml`)

```yaml
global:
  scrape_interval: 5s          # fast for the demo
  evaluation_interval: 5s
rule_files: [/etc/prometheus/alerts.yml]
alerting:                      # STRETCH (X9); remove this block if Alertmanager is not running
  alertmanagers:
    - static_configs: [{ targets: ["alertmanager:9093"] }]
scrape_configs:
  - job_name: backend          # discovers every replica (X1)
    metrics_path: /actuator/prometheus
    dns_sd_configs:
      - names: [backend]
        type: A
        port: 8080
        refresh_interval: 10s
  - job_name: nginx
    static_configs: [{ targets: ["nginx-exporter:9113"] }]
  - job_name: blackbox         # SILVER (X4): synthetic checks of the app
    metrics_path: /probe
    params: { module: [http_2xx] }
    static_configs:
      - targets: ["http://gateway:8080/healthz", "http://gateway:8080/"]
    relabel_configs:
      - { source_labels: [__address__], target_label: __param_target }
      - { source_labels: [__param_target], target_label: instance }
      - { target_label: __address__, replacement: "blackbox:9115" }
  - job_name: postgres         # STRETCH (X10)
    static_configs: [{ targets: ["postgres-exporter:9187"] }]
  - job_name: prometheus
    static_configs: [{ targets: ["localhost:9090"] }]
```

### 8.2 Alerts (`monitoring/prometheus/alerts.yml`)

Gauges computed from the database are reported by every replica, so alerts use `max()`.

```yaml
groups:
  - name: expenseflow
    rules:
      - alert: OldestPendingApprovalTooOld
        expr: max(expenseflow_oldest_pending_seconds) > 48 * 3600
        for: 1m
        labels: { severity: warning }
        annotations:
          summary: "Oldest pending approval is {{ $value | humanizeDuration }} old"
          runbook: "docs/runbook.md#oldest-pending-approval"
      - alert: BankPayoutFailing
        expr: max(expenseflow_payout_pending_batches) > 0
        for: 0s
        labels: { severity: critical }
        annotations:
          summary: "{{ $value }} payout batch(es) waiting for the bank"
          runbook: "docs/runbook.md#bank-down"
      - alert: BankCallErrors
        expr: sum(increase(expenseflow_bank_call_seconds_count{outcome="FAILURE"}[1m])) > 0
        for: 0s
        labels: { severity: critical }
        annotations: { summary: "Bank calls are failing" }
      - alert: BackendReplicaDown          # X1/X2
        expr: count(up{job="backend"} == 0) > 0
        for: 10s
        labels: { severity: warning }
        annotations: { summary: "A backend replica is down; traffic is on the remaining replicas" }
      - alert: BackendDown
        expr: sum(up{job="backend"}) == 0 or absent(up{job="backend"})
        for: 15s
        labels: { severity: critical }
        annotations: { summary: "No backend replica is up" }
      - alert: AppUnreachable              # X4 synthetic check
        expr: min(probe_success{job="blackbox"}) == 0
        for: 15s
        labels: { severity: critical }
        annotations: { summary: "Synthetic check failed: {{ $labels.instance }}" }
      - alert: HighErrorRate
        expr: sum(rate(http_server_requests_seconds_count{status=~"5.."}[1m])) / clamp_min(sum(rate(http_server_requests_seconds_count[1m])), 1) > 0.05
        for: 1m
        labels: { severity: warning }
        annotations: { summary: "5xx above 5%" }
      - alert: HighLatencyP95
        expr: histogram_quantile(0.95, sum by (le) (rate(http_server_requests_seconds_bucket{uri!~"/actuator.*"}[2m]))) > 1
        for: 2m
        labels: { severity: warning }
        annotations: { summary: "API p95 above 1 s" }
      - alert: SLOErrorBudgetFastBurn      # X3: 14.4x burn = 2% of a 30-day budget in 1 h
        expr: |
          (sum(rate(http_server_requests_seconds_count{uri!~"/actuator.*",status=~"5.."}[5m]))
            / clamp_min(sum(rate(http_server_requests_seconds_count{uri!~"/actuator.*"}[5m])), 1)) > (14.4 * 0.005)
        for: 2m
        labels: { severity: critical }
        annotations: { summary: "Availability SLO burning error budget 14x too fast" }
```

Grafana shows these under **Alerting → Alert rules → Data source-managed** (no Alertmanager needed to *see* them; Alertmanager is only for notifications, X9).

### 8.3 Grafana dashboard – row "ExpenseFlow"

| Panel | Type | PromQL |
|---|---|---|
| Pending approvals by level | bar | `max by (level) (expenseflow_pending_claims)` |
| Oldest pending approval (h) | stat, red > 48 | `max(expenseflow_oldest_pending_seconds) / 3600` |
| Policy outcomes (5 m) | time series | `sum by (outcome) (increase(expenseflow_policy_outcomes_total[5m]))` |
| Status transitions (5 m) | time series | `sum by (to) (increase(expenseflow_claim_transitions_total[5m]))` |
| Payout batches waiting for bank | stat, red > 0 | `max(expenseflow_payout_pending_batches)` |
| Bank call p95 / errors | time series | `histogram_quantile(0.95, sum by (le) (rate(expenseflow_bank_call_seconds_bucket[1m])))` and `sum(rate(expenseflow_bank_call_seconds_count{outcome="FAILURE"}[1m]))` |
| Duplicate submits caught | stat | `sum(expenseflow_idempotent_replays_total)` |
| API p95 by endpoint | time series | `histogram_quantile(0.95, sum by (le, uri) (rate(http_server_requests_seconds_bucket{uri!~"/actuator.*"}[2m])))` |

### 8.4 Row "Availability" (X1, X2, X4)

| Panel | Type | PromQL |
|---|---|---|
| Backend replicas up | stat (green = 2) | `sum(up{job="backend"})` |
| Requests per replica | time series | `sum by (instance) (rate(http_server_requests_seconds_count{uri!~"/actuator.*"}[1m]))` |
| Synthetic check | state timeline | `probe_success{job="blackbox"}` |
| Synthetic latency | time series | `probe_duration_seconds{job="blackbox"}` |

Keep the template's rows (gateway, backend, JVM, k6). Remove the cAdvisor row. Dashboard JSON lives in `monitoring/grafana/dashboards/`; export from the UI after editing and commit.

---

## 9. SLOs and error budget (X3, SILVER)

| SLO | Target | SLI (PromQL) |
|---|---|---|
| API availability | 99.5% of `/api` requests not 5xx | `1 - sum(rate(http_server_requests_seconds_count{uri!~"/actuator.*",status=~"5.."}[1h])) / sum(rate(http_server_requests_seconds_count{uri!~"/actuator.*"}[1h]))` |
| API latency | 95% of `/api` requests under 500 ms | `sum(rate(http_server_requests_seconds_bucket{uri!~"/actuator.*",le="0.5"}[1h])) / sum(rate(http_server_requests_seconds_count{uri!~"/actuator.*"}[1h]))` |
| Approval freshness | Oldest pending approval under 48 h | `max(expenseflow_oldest_pending_seconds) < 48*3600` |
| Payout delivery | Batches sent to the bank within 5 min | `max(expenseflow_payout_pending_batches) == 0` outside drills |

Error budget remaining (availability): `1 - ((1 - <availability SLI>) / (1 - 0.995))` as a gauge (green > 50%, amber > 0, red ≤ 0).
Row "SLOs" in Grafana: one stat per SLI with the target as a threshold, plus the error-budget gauge. The 1 h window suits a hackathon; in production it would be 30 days. Write the SLO table into the runbook and one deck slide.

---

## 10. CI/CD (`.github/workflows/ci-cd.yml`)

| Job | Steps | Evidence | Tier |
|---|---|---|---|
| lint | hadolint on 3 Dockerfiles; `docker compose config -q` | log | GOLD |
| secrets-scan | `docker run --rm -v ${{ github.workspace }}:/repo zricethezav/gitleaks:latest detect --source /repo --no-banner` | "no leaks found" | GOLD |
| backend | JDK 25, `./mvnw -B verify`; upload `target/surefire-reports` | test report | GOLD |
| frontend | Node 26, `npm ci`, `npm run build`, `npm audit --audit-level=high` (report only) | build log, audit | GOLD |
| dependency-check | `aquasec/trivy:0.57.1 fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 .` | Trivy table | GOLD |
| build-scan-test | secret file; `docker compose build`; Trivy image scan; `up -d --wait` (2 replicas); `bash tests/integration.sh` | PASS list | GOLD |
| sbom (X6) | `trivy image --format cyclonedx -o sbom-<service>.cdx.json <image>` for backend, frontend, gateway; upload as artifacts | SBOM files | SILVER |
| load-test (main only) | full stack + monitoring; k6 smoke 30 s against `backend:8080` | k6 summary | GOLD |
| release (X7, tag `v*`) | `environment: production` (required reviewer: Dipesh) → build images tagged with the version → SBOM → `up -d --wait` → `integration.sh` → attach SBOM + test reports to the GitHub Release | approval screenshot, release page | SILVER |

**Dependabot (X6)** – `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - { package-ecosystem: maven,          directory: /backend,  schedule: { interval: weekly } }
  - { package-ecosystem: npm,            directory: /frontend, schedule: { interval: weekly } }
  - { package-ecosystem: docker,         directory: /backend,  schedule: { interval: weekly } }
  - { package-ecosystem: docker,         directory: /frontend, schedule: { interval: weekly } }
  - { package-ecosystem: github-actions, directory: /,         schedule: { interval: weekly } }
```

Approval gate: *Settings → Environments → New environment "production" → Required reviewers*. If Actions runners aren't available on company GitHub, run the same via `scripts/check.ps1` + `scripts/scan.ps1` and say so in the deck.

---

## 11. Scripts (`scripts/`, PowerShell, each prints PASS/FAIL)

| Script | Does | Tier |
|---|---|---|
| `check.ps1` | secret file → backend tests → frontend build → full stack up `--wait` → `integration.sh` | GOLD |
| `scan.ps1` | gitleaks + Trivy fs + Trivy image + SBOM; saves to `evidence/security/` | GOLD (SBOM: SILVER) |
| `reset-demo.ps1` | `down -v` → full stack up `--wait` → login as each demo user → prints counts per status | GOLD |
| `drill.ps1 bank-stop\|bank-start\|kill-replica` | stops/starts WireMock, or crashes one backend replica; prints batch status, replicas up and firing alerts | GOLD (kill-replica: SILVER) |
| `backup-db.ps1` / `restore-db.ps1` (X5) | see 11.1 | SILVER |
| `rolling-restart.ps1` (X8) | restarts backend replicas one at a time, waiting for healthy between them | SILVER |
| `evidence.ps1` | saves `docker compose ps`, reports, k6 summaries, Trivy, SBOM into `evidence/<timestamp>/` | GOLD |

### 11.1 Backup and restore (X5)

PowerShell `>` corrupts binary output, so copy the file out of the container instead:

```powershell
# backup-db.ps1
$ts = Get-Date -Format "yyyyMMdd-HHmmss"; New-Item -ItemType Directory -Force backups | Out-Null
docker compose exec postgres pg_dump -U app -d app -Fc -f /tmp/app.dump
docker compose cp postgres:/tmp/app.dump "backups/app_$ts.dump"
# restore-db.ps1 <file>
docker compose cp $args[0] postgres:/tmp/restore.dump
docker compose exec postgres pg_restore -U app -d app --clean --if-exists /tmp/restore.dump
```

Prove it: back up → delete a few claims → restore → counts match. Time the restore (RTO) and note RPO = time since last backup. Record both in the runbook. `backups/` is git-ignored.

### 11.2 Kill one replica and rolling restart (X2, X8)

```powershell
# crash one replica (Docker restarts it: a crash is not a manual stop)
$id = docker compose ps -q backend | Select-Object -First 1
docker exec $id kill 1
# rolling restart
foreach ($id in docker compose ps -q backend) {
  docker restart $id | Out-Null
  do { Start-Sleep 3; $h = docker inspect -f "{{.State.Health.Status}}" $id } until ($h -eq "healthy")
  Write-Host "PASS $id healthy"
}
```

---

## 12. Drills

### 12.1 Drill 1 – bank outage (GOLD, live in the demo 3:20–4:05)

| Step | Who / command | Expected | Screenshot |
|---|---|---|---|
| 0 | Before the demo: dashboard open, Prometheus targets all UP | `BankPayoutFailing` inactive | `drill1-0-baseline.png` |
| 1 | Prasang: `scripts/drill.ps1 bank-stop` | `bank` health DOWN in `/actuator/health`; app still works | `drill1-1-bank-down.png` |
| 2 | Mohit (as HEAD): create payout batch | UI "Waiting for bank"; claims IN_PAYOUT; no error page | `drill1-2-waiting.png` |
| 3 | Grafana | "Payout batches waiting" = 1 (red); `BankPayoutFailing` firing within ~20 s | `drill1-3-alert.png` |
| 4 | Prasang: `scripts/drill.ps1 bank-start` | Retry job sends the file; batch SENT; claims PAID | `drill1-4-recovered.png` |
| 5 | Grafana + claim timeline | Panel back to 0; alert resolved; timeline shows `PAYOUT_SEND_FAILED` then `PAYOUT_SENT` | `drill1-5-resolved.png` |

To fit 45 s, set `PAYOUT_RETRY_INTERVAL_MS=10000` on the demo laptop (`.env`) and note it in the runbook.

### 12.2 Drill 2 – replica crash under load (SILVER, evidence slide; live only if rehearsal has spare time)

| Step | Command | Expected | Evidence |
|---|---|---|---|
| 0 | `$env:TARGET="http://gateway:8080"; VUS=10` k6 run (low load, under the rate limit) | 2 replicas up, both serving traffic | `drill2-0-two-replicas.png` |
| 1 | `scripts/drill.ps1 kill-replica` | `BackendReplicaDown` fires; "Requests per replica" shows all traffic on one | `drill2-1-one-down.png` |
| 2 | wait ~60 s | Docker restarts it; replicas back to 2; alert resolves | `drill2-2-recovered.png` |
| 3 | k6 summary | Record the real failed-request count (target 0; report what you measure) | `evidence/k6-replica-drill.json` |

### 12.3 Drill 3 – backup and restore (SILVER, runbook)

Backup → delete 5 claims → restore → verify counts → record RTO. Screenshot the before/after counts.

---

## 13. Load and scale tests (k6)

```powershell
# real capacity, straight to the backend replicas (DNS round-robin)
$env:TARGET="http://backend:8080"; docker compose --profile loadtest run --rm k6
# through the gateway: shows 429 rate limiting
Remove-Item Env:TARGET; docker compose --profile loadtest run --rm k6
# X11 scale test: same backend run with 1 replica, then 2; compare req/s and p95
docker compose up -d --scale backend=1 --no-recreate   # run k6, save summary
docker compose up -d --scale backend=2 --no-recreate   # run k6 again, save summary
```

Script: `loadtest/load.js` per playbook P14 (login once per role in `setup()`, 70% reads / 30% writes with unique Idempotency-Keys, p95 < 500 ms and errors < 1%, `handleSummary` → `evidence/k6-*.json`). Run once early (T+110) and once final. Report numbers as measured – if 2 replicas don't help much on one laptop (shared CPU), say so honestly.

---

## 14. Alert notifications (X9, STRETCH)

`monitoring/alertmanager/alertmanager.yml`:

```yaml
route:
  receiver: team-webhook
  group_wait: 5s
  group_interval: 10s
  repeat_interval: 1h
receivers:
  - name: team-webhook
    webhook_configs:
      - url: http://notifier:8080/alerts
        send_resolved: true
```

`notifier` is a **second** WireMock container (so bank-down alerts still get delivered when the bank WireMock is stopped) with one mapping: `POST /alerts` → 200. Show delivered alerts with `curl.exe -s "localhost:8090/__admin/requests?limit=5"` (dev file). In production this webhook would be Slack/Teams/PagerDuty.

---

## 15. Demo-day operations

- **Demo laptop:** Dipesh. **Hot standby:** Prasang, same commit, same `.env`.
- **T–15 min checklist:** `git pull` → `scripts/reset-demo.ps1` all PASS → `docker compose ps` shows 2 healthy backend replicas → tabs open: app (375 px window + normal), Grafana (ExpenseFlow, Availability, SLOs rows), Swagger UI → `BankPayoutFailing` inactive → `OldestPendingApprovalTooOld` firing (expected, stuck seed claim) → backup video ready offline.
- Optional LAN access for judges: `http://<demo-laptop-IP>:8080` (Windows Firewall must allow 8080).
- After any fix during the buffer: `check.ps1`, then `reset-demo.ps1`.

---

## 16. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `up --wait` hangs then fails | A healthcheck fails: `docker compose ps`, then `docker compose logs <service>` |
| Postgres exits at start | Wrong volume path for 18, or stale volume from 16: `docker compose down -v` |
| Backend restarts, "relation does not exist" | Flyway didn't run: check the Flyway starter + `flyway-database-postgresql` in `pom.xml` |
| Backend "Schema-validation: missing column" | Entity and migration differ: entity follows the migration |
| Gateway won't start: `invalid parameter "resolve"` | nginx older than 1.27.3: remove `zone`/`resolve`, restart gateway after scaling |
| Only one replica gets traffic | Gateway resolved DNS before the 2nd replica existed: `docker compose restart gateway` |
| A batch was sent twice | Retry job not using `FOR UPDATE SKIP LOCKED` (section 6.4) |
| Grafana numbers doubled | Gauge panel uses `sum()` instead of `max()` |
| Gateway 502 | No healthy backend replica |
| Gateway 429 during tests | Expected under load; Playwright login limit is 30/min |
| Login always 401 with seeded users | Hash not BCrypt-compatible: use pgcrypto `gen_salt('bf')` |
| Grafana panels empty | No traffic yet, or target DOWN: `localhost:9090/targets` (dev file) |
| Alert never fires | `rule_files` path or mount wrong: `localhost:9090/rules` must list the group |
| Bank never recovers | `@EnableScheduling` missing or wrong `EXTERNAL_SERVICE_URL` (`http://wiremock:8080` in Docker) |
| Laptop out of memory | `BACKEND_REPLICAS=1`; stop the STRETCH services |

---

## 17. DevOps evidence checklist (test results, runbook, deck)

- [ ] `docker compose ps`: all healthy, 2 backend replicas (clean clone)
- [ ] `check.ps1` all PASS
- [ ] CI run green (or local pipeline output); release approval gate screenshot (X7)
- [ ] gitleaks "no leaks", Trivy reports, SBOM files (X6)
- [ ] Grafana: ExpenseFlow, Availability and SLO rows
- [ ] Drill 1 screenshots 0–5 (bank outage)
- [ ] Drill 2 screenshots + k6 summary (replica crash) (X2)
- [ ] Backup/restore proof with RTO (X5)
- [ ] k6 summaries: backend, gateway, 1 vs 2 replicas (X11)
- [ ] Prometheus rules page showing all alerts
- [ ] Runbook written from the real drills (`docs/runbook.md`)

**Deck slide "Production-readiness extras":** load-balanced replicas with self-healing · SLOs with error budget and burn-rate alert · synthetic monitoring · backup/restore with measured RTO · SBOM + Dependabot + secrets scan · release pipeline with approval gate.
