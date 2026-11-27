# ExpenseFlow – Demo Instructions (Team 45)

Golden flow from README §3, run against the real stack (gateway `http://localhost:8080`, 2 backend replicas, PostgreSQL, WireMock mock bank, Grafana).

## 0. Prepare (10 minutes before)

| # | Do | Why |
|---|---|---|
| 1 | In `.env` set `PAYOUT_RETRY_INTERVAL_MS=10000` | Bank retry runs every 10 s instead of 30 s |
| 2 | `powershell -ExecutionPolicy Bypass -File scripts/reset-demo.ps1 -Yes` | Wipes data, rebuilds, starts the stack with the new `.env`, re-seeds, checks all 6 demo logins (also removes k6 load-test claims) |
| 3 | Browser window A: Chrome DevTools → device toolbar → **375 × 812**, open `http://localhost:8080` | Employee steps are shown at phone width |
| 4 | Browser window B (desktop, 1440 wide): `http://localhost:8080` | Manager / auditor / head steps |
| 5 | Window C: Grafana `http://localhost:3000` → dashboard **Hackathon – Overview** | Shows the bank alert in step 6 |
| 6 | In window B, sign in as `colleague.demo@expenseflow.test`, open their claim from **My claims** (status *With manager*), copy the URL (`/claims/<id>`), sign out | URL to paste in step 4 |
| 7 | Have 4 receipt images on the desktop (any JPEG/PNG ≤ 5 MB): hotel, meals, cab, flight | Receipts for step 1 |
| 8 | Terminal open in the repo root (Prasang) | `scripts/drill.ps1 bank-stop` / `bank-start` |

The login page has one-click chips for Employee, Manager, Auditor and Finance head (they fill email + `Demo@123`). Switch users with **Sign out** (sidebar, or ☰ menu at 375 px).

## 1. Five-minute demo script

| Step (time) | User | Clicks | What to say | Expected screen |
|---|---|---|---|---|
| 1a (0:00–1:15) | EMPLOYEE `emp.demo` – window A, 375 px | Login → **Employee** chip → **Sign in** → **New claim**. Title "Mumbai client visit". Line 1 **Hotel**: 22500, last weekday, "Hotel Sea Pearl", city Mumbai, 3 nights, attach receipt. **Add another expense** → **Meals** 1200 + receipt. → **Local cab** 800, date = last **Saturday**, + receipt. → **Flight** 6000 + receipt | "Asha files a Mumbai trip from her phone. Every receipt is hashed on upload. As she types, the app previews the policy: hotel is over the tier-1 limit, the cab is on a weekend, flights have no policy – so it predicts a 2-step review." | Line cards with live flag notes; bottom bar shows ₹30,500 total and route "2-step review – Manager, Auditor" |
| 1b (1:15–1:35) | EMPLOYEE | **Save draft**, then **double-click Submit claim** | "Save as draft, then I double-click Submit on purpose. The button locks and the request carries an Idempotency-Key, so this is still one claim." | Toast "Draft saved", then toast "EXP-… submitted · Sent for review"; claim detail page. **My claims** shows the claim once |
| 2 (1:35–1:55) | SYSTEM (stay on detail) | Scroll the lines | "The server's policy engine ran: hotel Over limit (R2), cab Weekend (R6), flight No policy. Above ₹25,000, so manager then auditor (R9)." | Badge **With manager**; chips **Over limit**, **Weekend**, **No policy**; chain tracker Submitted → Manager → Auditor |
| 3 (1:55–2:35) | MANAGER `mgr.demo` – window B | Sign out → **Manager** chip → **Approvals** → open "Mumbai client visit" → **Approve** → comment "Client visit confirmed" → **Confirm** | "Vikram sees receipts on the left and flagged lines on the right – a decision in under 30 seconds. Over ₹25,000, so it moves on to the auditor." | Approver view: receipt viewer + lines with flags + decision bar; back on the queue, the claim is gone |
| 4a (2:35–2:55) | EMPLOYEE `emp.demo` – window A | Paste the colleague's claim URL from prep step 6 | "Asha tries to open Rohan's claim by guessing the URL. The server answers 404, not 403 – it doesn't even confirm the claim exists (R13)." | "Not found – Claim not found" |
| 4b (2:55–3:10) | MANAGER – window B | **My claims** → open Vikram's own pending claim | "Vikram can't approve his own claim: no buttons here, and the API returns 403 if you try (R15)." | Own claim **With manager**, no Approve / Send back / Reject bar |
| 5 (3:10–3:45) | AUDITOR `auditor.demo` – window B | Sign out → **Auditor** chip → **Approvals** → filter pill **Over limit** → tick "Mumbai client visit" → **Bulk approve** → **Approve 1 · ₹30,500** | "Kavya filters the queue by flag and bulk-approves. Each claim is checked on its own; a bad one is skipped, not the whole batch." | Results dialog "Bulk approve results" with **Approved**; claim leaves the queue |
| 6a (3:45–4:15) | HEAD `head.demo` – window B, terminal | Terminal: `powershell -ExecutionPolicy Bypass -File scripts/drill.ps1 bank-stop`. Sign out → **Finance head** chip → **Payouts** → tick the claim → **Create batch** → **Pay ₹30,500** | "The bank is down. Meera still creates the batch. Nothing breaks: claims stay In payout, the UI says Waiting for bank, and Grafana fires BankPayoutFailing." | Batch card **Waiting for bank**, "Attempt 1", last error; window C: alert firing within ~10–20 s |
| 6b (4:15–4:35) | HEAD, terminal | `powershell -ExecutionPolicy Bypass -File scripts/drill.ps1 bank-start` (or **Retry now**) | "Bank is back. The retry job resends within 10 seconds – exactly once – and the claims become Paid (R12)." | Batch **Sent**, "Bank ref BNK-…"; alert resolves |
| 7 (4:35–5:00) | HEAD | **Dashboard** → back to the claim (Payouts / search) → scroll to **Activity** | "Dashboard: KPIs, spend, pending by level, violations. And every step of this claim is in an append-only audit trail with who, when and on whose behalf (R14)." | Dashboard KPI cards + charts; claim **Paid** with the Activity timeline (created → submitted → approvals → payout → paid) |

**If something fails live:** play `evidence/demo/golden-flow-1440.webm` (or `-375`), or show the screenshots in section 3.

## 2. Run it yourself

**Prerequisites**
- Windows 10/11 with PowerShell 5.1+ (macOS/Linux work with the same `docker compose` commands)
- Docker Desktop running (Compose v2); ports 8080 and 3000 free. Each backend replica needs about 0.8 GB RAM (limit 768 MB); on a tight laptop set `BACKEND_REPLICAS=1` in `.env`
- Git. Not needed for the app itself: Node or Java (everything builds in containers)
- `.env` is optional – every value has a default (`copy .env.example .env` to change ports, passwords, retry interval)

**Start (one command, repo root)**

```powershell
docker compose up -d --build --wait
```

First build takes a few minutes. `docker compose ps` should show 2 healthy `backend` rows. Full gate (tests + build + stack + integration tests): `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`.

**URLs**

| Open | URL |
|---|---|
| App (through the nginx gateway) | http://localhost:8080 |
| Swagger UI | http://localhost:8080/api/swagger-ui.html |
| Grafana (`admin` / `change-me`) – dashboard "Hackathon – Overview" | http://localhost:3000 |
| Prometheus / WireMock (only with `-f docker-compose.dev.yml`) | http://localhost:9090 / http://localhost:8089/__admin |

**Demo users** (password `Demo@123`, synthetic)

| Role | Email | Name in the app | Notes |
|---|---|---|---|
| EMPLOYEE | `emp.demo@expenseflow.test` | Asha Verma | Main claimant, reports to `mgr.demo` |
| EMPLOYEE | `colleague.demo@expenseflow.test` | Rohan Iyer | Owns the claim used for the 404 demo |
| MANAGER | `mgr.demo@expenseflow.test` | Vikram Nair | Manager of both; has one own pending claim (403 demo) |
| MANAGER | `mgr.leave@expenseflow.test` | Neha Kulkarni | On leave; delegated to `mgr.demo` for today ± 3 days |
| AUDITOR | `auditor.demo@expenseflow.test` | Kavya Reddy | Queue filters, bulk approve, sample audit |
| HEAD | `head.demo@expenseflow.test` | Meera Krishnan | > ₹1,00,000 approvals, payouts, dashboard, admin |

**Reset demo data** (destructive – drops the database volume, Flyway re-seeds)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/reset-demo.ps1 -Yes
```

Equivalent by hand: `docker compose down -v` then `docker compose up -d --build --wait`. After a reset the `OldestPendingApprovalTooOld` alert fires by design (one seeded claim is 3 days old).

## 3. Screenshots if the video can't be played (`evidence/ui/`)

The numbered set is the curated deck. The other files are full-page captures of every README §8 route per demo user, from `frontend/e2e/screenshots.spec.ts`. Both sets were made with the built-in mock data, so they don't show the "Mumbai client visit" claim itself.

| Golden-flow step | 375 px | 1440 px |
|---|---|---|
| Sign in | `01-login-375.png` | `01-login-1440.png` (dark: `01-login-1440-dark.png`) |
| 1 Employee creates the claim | `03-claim-capture-375.png` (dark: `03-claim-capture-375-dark.png`) | `03-claim-capture-1440.png` |
| 1 My claims after submit | `02-my-claims-375.png` | `02-my-claims-1440.png` |
| 2 Claim with flags, status, chain | `04-claim-detail-375.png` | `04-claim-detail-1440.png` |
| 3 Manager queue | `05-approval-queue-375.png` | `05-approval-queue-1440.png` |
| 3 Approver view (receipts + flags + decision bar) | `06-approver-view-375.png` | `06-approver-view-1440.png` (dark: `06-approver-view-1440-dark.png`) |
| 5 Auditor queue with filters / bulk select | `approvals-auditor-375.png` | `approvals-auditor-1440.png` |
| 6 Payouts (eligible claims, batches) | `07-payouts-375.png` | `07-payouts-1440.png` |
| 7 Dashboard | `08-dashboard-375.png` | `08-dashboard-1440.png` (dark: `08-dashboard-1440-dark.png`) |
| Extra: policy rules | `09-policy-375.png` | `09-policy-1440.png` |

**Not covered by a screenshot:** step 4 (the "Claim not found" page and the manager's own claim with no decision bar), the bulk-approve results dialog, and the "Waiting for bank" → "Sent" batch states. All of them appear in `evidence/demo/golden-flow-*.webm`.
