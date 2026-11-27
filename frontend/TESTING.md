# Frontend testing — ExpenseFlow (owner: Mohit)

## Run
```bash
npm test               # all tests once (Vitest + Testing Library + jsdom)
npm run test:watch     # watch mode
npm run test:coverage  # coverage for src/lib, src/api, src/components/ds
```
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
- Adding a line crashed for one render: the line previews lagged behind the field array.
- `CountUp` could show negative or stuck totals: rAF timestamps can be earlier than `performance.now()`, and a new value mid-animation restarted from a stale number.
- "Today" was computed in UTC, so between 00:00 and 05:30 IST a same-day expense was rejected as "in the future".
- A fast double-click on Submit created two claims (UI lock + idempotency dedupe).

## Manual checks done at 375 px (Chrome device emulation)
Login · My claims · New claim (category grid, city dropdown, sticky total bar) · Claim detail · Approvals (cards) · Approver view (receipt → lines → sticky decision bar, bottom-sheet dialog with required comment) · Dashboard · Payouts · Delegation · Policy · 404 · nav drawer. A script found no horizontal overflow on any route.

## Run against the backend
`npm run dev` proxies `/api` to `http://localhost:8080` (override with `VITE_API_TARGET`). `npm run dev:prism` uses Prism on 4010; `npm run dev:mock` needs no server. Demo IDs differ between the mock and the backend seed. Tests use emails, not IDs.

## Next
- Playwright e2e of the golden demo flow at 375 px against the docker stack (`data-testid`s are already in place).
