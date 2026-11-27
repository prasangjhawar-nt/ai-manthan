# Frontend testing — ExpenseFlow (owner: Mohit)

## Run
```bash
npm test               # unit + component + API-integration tests (Vitest + Testing Library + jsdom)
npm run test:watch     # watch mode
npm run test:coverage  # coverage for src/lib, src/api, src/components/ds
npm run e2e            # Playwright E2E, desktop + 375 px projects (starts/reuses the mock dev server)
npm run e2e:mobile     # only the 375 px project
npm run e2e:report     # open the HTML report (e2e/report)
BASE_URL=http://localhost:8080 npm run e2e   # same suite against the docker gateway / real backend
```

## Test pyramid (frontend)
| Level | Tool | File | Tests |
|---|---|---|---|
| Unit — validation & policy preview (R1–R9, R16), local-date safety | Vitest | `src/lib/claim-rules.test.ts` | 20 |
| Unit — INR/compact/duration formatting, status language | Vitest | `src/lib/format.test.ts` | 15 |
| Unit — auth: role homes, login/logout, restore, auto-expiry | Vitest | `src/lib/auth.test.tsx` | 9 |
| Unit — API client: headers, query building, problem+json, 401 sign-out, network errors, session | Vitest (stubbed transport) | `src/api/client.test.ts` | 14 |
| Unit — design system: Amount, chips, states, Segmented, CityCombobox keyboard, Modal, Field, toasts, CountUp, theme | Vitest + Testing Library | `src/components/ds/components.test.tsx`, `ds.test.tsx` | 32 |
| Integration — every story through `src/api/*` against the contract mock | Vitest | `src/api/api.test.ts` | 26 |
| Integration — remaining rules & permissions: R5 duplicates, full chain to head, wrong-level 403, reject/send-back, R17 resubmit, edit locks, R11 sample audit, delegation, payout idempotency/detail, dashboard range, comments, policy | Vitest | `src/api/rules.test.ts` | 20 |
| Component — pages with router + query + auth (login, claim form, lists, approvals, policy, decisions) | Vitest + Testing Library | `src/pages/pages.test.tsx` | 18 |
| Component — routing & role guards, shell, Dashboard, Payouts, Delegation, claim detail branches, form edit/draft, list search, login edge cases, queue filters & bulk results | Vitest + Testing Library | `src/pages/screens.test.tsx` | 32 |
| **E2E (README §12)** — real browser, desktop + 375 px | **Playwright (TS), HTML report** | `e2e/expenseflow.spec.ts` | 15 cases × 2 projects = 30 |

**Totals:** 186 Vitest tests in 10 files plus 30 Playwright runs. **Coverage** (`npm run test:coverage`, report in `coverage/`): 90.6% statements · 83.9% branches · 86.9% functions · 94.0% lines.

## E2E cases (README §12 — all 10 automated, required minimum was 03/05/06/09/10)
| ID | Case | Test |
|---|---|---|
| E2E-01 | login per role + correct menu | 4 role tests (home page, menu shown/hidden) + wrong password + role can't open another role's URL |
| E2E-02 | create draft with receipts, reopen, edit | save draft with 2 receipts → reopen from list → receipts kept → edit amount → total updated |
| E2E-03 | double-click submit → one claim | `dblclick` Submit → search shows exactly 1 |
| E2E-04 | missing receipt above 500 → auto-rejected with reason | live preview warns → Rejected → "Rejected by policy" + "No receipt" on the line |
| E2E-05 | over-limit hotel routed, manager approves ≤ 25,000 → APPROVED | 7,000/night in Mumbai flagged → manager approves → employee sees Approved |
| E2E-06 | > 25,000 → manager → auditor bulk approve | manager approves → auditor filters Over limit → selects → bulk approve → results → Approved |
| E2E-07 | send back → edit → resubmit → routed again | comment required → employee sees comment → edits → With manager |
| E2E-08 | delegate approves for manager on leave | report of mgr.leave submits → mgr.demo approves → "on behalf of Neha Kulkarni" in timeline |
| E2E-09 | colleague's claim not found; manager approving own blocked | 404 page for colleague's URL; no decision UI on own claim **and** API returns 403 |
| E2E-10 | payout with bank down → waiting → bank up → PAID | batch "Waiting for bank" (attempt 1) → Retry now → Sent + bank ref → claim Paid |

Against the real backend, set `E2E_DELEGATOR_REPORT` to an employee who reports to `mgr.leave`. E2E-10's "bank down" step needs WireMock stopped. The mock fails the first send by design.
Tests run against `src/api/mock.ts` (contract-v1 + README business rules) with zero latency. The DB is reseeded before every test.

## What is covered
| Story / rule | Test file | Cases |
|---|---|---|
| ST-01 login, 401/403, token expiry | `src/api/api.test.ts`, `src/pages/pages.test.tsx` | valid login → JWT + role; wrong password → 401; no token → 401 + auto-logout; EMPLOYEE on approver API → 403; expired token dropped; form validation; demo chips |
| ST-02 draft, edit, receipts | `api.test.ts`, `pages.test.tsx` | DRAFT with total; optimistic-lock 409 on stale version; SHA-256 + duplicate receipt; 415 type / 413 size; field errors (400); add/remove lines with running total; bad file type blocked client-side |
| ST-03 submit + policy (R1–R8, R16) | `claim-rules.test.ts`, `api.test.ts`, `pages.test.tsx` | idempotent double submit = one claim; OVER_LIMIT / NO_POLICY / WEEKEND / MISSING_RECEIPT; R4 boundary at exactly ₹500; hotel per-night by city tier; meals per day; cab per trip; auto-approve ≤ ₹5,000 only when clean; live preview in the form |
| ST-04 / R13 visibility | `api.test.ts`, `pages.test.tsx` | only own claims; another's claim → 404 (not 403); tab filters |
| ST-05 / R9 / R15 manager | `api.test.ts` | > ₹25,000 → PENDING_AUDITOR; send back needs comment (400); own claim → 403; invalid transition → 409 |
| ST-06 / R10 delegation | `api.test.ts` | delegate approves; step and audit store both people |
| ST-07 auditor | `api.test.ts`, `pages.test.tsx` | flag filter; bulk approve processes each claim, unknown id SKIPPED 404; sample audit clear (403 for non-auditor); select-all + bulk bar; manager has no bulk select |
| ST-08/09 head + payout (R12) | `api.test.ts` | eligible = APPROVED and no open sample audit; batch → IN_PAYOUT + PENDING_SEND; retry → SENT + bank ref; CSV header |
| ST-10 dashboard | `api.test.ts` | MANAGER → 403; KPIs + charts present |
| ST-11 / R14 audit | `api.test.ts` | one row per action with from/to status |
| Validation (README 4.2) | `claim-rules.test.ts` | future date, > 90 days (exactly 90 ok), amount > 0, ≤ 10,00,000, ≤ 2 decimals, vendor required/≤ 120, HOTEL city + nights 1–30 whole, 1–20 lines, title; local-timezone "today" |
| R9 thresholds | `claim-rules.test.ts`, `pages.test.tsx` | strict "above": 25,000 → manager only, 25,000.01 → + auditor, 1,00,000.01 → + head |
| Design system | `format.test.ts`, `pages.test.tsx` | INR lakh grouping, compact units, durations; every status has a label/tone; +N flag tooltip trigger has an accessible name; city combobox keyboard + free text |

## Bugs these tests caught (fixed)
- `getPayoutBatch` (GET `/api/payout-batches/{id}` in the swagger) was missing from `src/api/endpoints.ts`; added.
- **E2E:** after Approve / Send back / Reject the approver stayed on the claim with no confirmation. The decision bar unmounts when the claim refetches, and TanStack Query drops per-call `mutate()` callbacks for unmounted observers. Fixed with `mutateAsync`; a component regression test covers it.
- **E2E infra:** Vite reloaded the page whenever Playwright wrote trace files under `e2e/`, so the folder is now excluded from the watcher.
- Adding a line crashed for one render: the line previews lagged behind the field array.
- `CountUp` could show negative or stuck totals: rAF timestamps can be earlier than `performance.now()`, and a new value mid-animation restarted from a stale number.
- "Today" was computed in UTC, so between 00:00 and 05:30 IST a same-day expense was rejected as "in the future".
- A fast double-click on Submit created two claims (UI lock + idempotency dedupe).

## Manual checks done at 375 px (Chrome device emulation)
Login · My claims · New claim (category grid, city dropdown, sticky total bar) · Claim detail · Approvals (cards) · Approver view (receipt → lines → sticky decision bar, bottom-sheet dialog with required comment) · Dashboard · Payouts · Delegation · Policy · 404 · nav drawer. A script found no horizontal overflow on any route.

## Run against the backend
`npm run dev` proxies `/api` to `http://localhost:8080` (override with `VITE_API_TARGET`). `npm run dev:prism` uses Prism on 4010; `npm run dev:mock` needs no server. Demo IDs differ between the mock and the backend seed. Tests use emails, not IDs.

## Next
- Run `BASE_URL=http://localhost:8080 npm run e2e` once the docker stack is up, and save the HTML report under `evidence/`.
