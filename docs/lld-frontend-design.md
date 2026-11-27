## Frontend design

React 19 + Vite + TypeScript (strict), React Router 7, TanStack Query 5, react-hook-form + zod 4, Recharts, sonner toasts, lucide icons. Primitives are our own design system in `src/components/ds/` (dialogs/tooltips on `@base-ui/react`), plus a few shadcn files in `components/ui/`. Bootstrapped in `main.tsx`: `QueryClientProvider → BrowserRouter → AuthProvider → TooltipProvider → App` + `<Toaster>`.

### 1. Route map, roles and guards (`App.tsx`)

| Route | Roles | Screen |
|---|---|---|
| `/login` | public (signed-in → role home) | `LoginPage` (eager) |
| `/` | any | redirect to `homeFor(role)`: EMPLOYEE `/claims`, MANAGER `/approvals`, AUDITOR/HEAD `/dashboard` |
| `/claims`, `/claims/new`, `/claims/:id/edit`, `/claims/:id` | any signed-in | `ClaimsPage`, `ClaimFormPage` (new + edit), `ClaimDetailPage` |
| `/approvals`, `/approvals/:id`, `/delegation` | MANAGER, AUDITOR, HEAD | `ApprovalsPage`, `ClaimDetailPage approverView`, `DelegationPage` |
| `/dashboard` | AUDITOR, HEAD | `DashboardPage` |
| `/payouts`, `/admin/users` | HEAD | `PayoutsPage`, `RegisterUserPage` |
| `/policy` | any signed-in | `PolicyPage` |
| `*` | any signed-in | `NotFoundPage` |

All signed-in routes nest under one `<RequireAuth><AppShell/></RequireAuth>` layout route. `RequireAuth` (no user → `/login` with `state.from`, used after login; wrong role → `homeFor(role)`) is applied again per route with `roles`. The sidebar `NAV` list in `AppShell` is filtered by the same role sets. The guards control the UI only; ownership (`/claims/:id` of another user → 404) and self-approval (403) are enforced by the server. Every page except Login is `React.lazy` and renders inside one `<Suspense>` in the shell.

### 2. Component tree per screen

```
AppShell ─ aside>SidebarNav (lg) | Drawer>SidebarNav (<lg) ─ main#workspace ─ sticky mobile bar (menu, Logo, TopActions) ─ <Outlet/>
LoginPage      ─ form (email, password, demo-user chips) · FloatCard previews
ClaimsPage     ─ PageHeader+HeaderActions · Stat×4 · Segmented tabs + search · ClaimTable (md+) | ClaimCards (<md) · LoadingRows/EmptyState/ErrorState
ClaimFormPage  ─ (FormSkeleton | ErrorState | ClaimForm) ─ PageHeader · clarification note · LineCard×n
                  (category radiogroup, amount/date/vendor, CityCombobox, nights, ReceiptPicker, live flag notes) · summary aside (total, RouteHint, Submit, Save draft)
ClaimDetailPage─ (DetailSkeleton | ErrorState | Detail) ─ header + ChainTracker · Clarification/RejectionBanner · ReceiptViewer (approver)
                  · LineRow×n (FlagChip) · Activity (AuditItem, CommentItem, CommentBox) · DecisionBar | SampleAuditBar
ApprovalsPage  ─ PageHeader · Stat×4 · flag FilterPill row · FilterPanel (AUDITOR) · QueueTable (checkboxes on PENDING_AUDITOR) · BulkBar (+ results dialog)
PayoutsPage    ─ PageHeader · Stat2 · eligible list with Checkbox + select-all · create-batch Modal · BatchItem×n (status, Retry now, CSV)
DashboardPage  ─ range picker · Kpi×4 · SpendOverTime (AreaChart) · PendingByLevel · CategoryBreakdown (PieChart) · Departments · Exceptions · Violations
PolicyPage     ─ ThresholdRuler · LimitsLedger · LineChecks          DelegationPage ─ form + list          RegisterUserPage ─ SingleRegister | BulkRegister (CSV)
```

### 3. Data fetching (`api/hooks.ts`)

`QueryClient` defaults: `staleTime` 15 s, no refetch on window focus. Retry is off for any 4xx and allows up to 2 retries for network errors and 5xx. Query keys come from the `qk` factory:

| Key | Hook | Notes |
|---|---|---|
| `["claims","mine",status\|"ALL"]` | `useMyClaims` | `keepPreviousData` |
| `["claims",id]`, `["claims",id,"comments"]`, `["claims",id,"audit"]` | `useClaim`, `useComments`, `useAuditTrail` | `useClaim` is enabled only for a finite id |
| `["queue",filters]` | `useQueue` | also feeds the nav badge; `keepPreviousData` while filters change |
| `["payout","eligible"]`, `["payout","batches"]` | `useEligible`, `useBatches` | batches poll every 4 s while any is `PENDING_SEND` |
| `["dashboard",from,to]`, `["policy"]`, `["delegations"]` | `useDashboard`, `usePolicy` (stale 10 min), `useDelegations` | |

**Invalidation.** Mutations don't patch the cache (`setQueryData` isn't used). After a state change they call `useInvalidateClaims()`, which invalidates the `["claims"]`, `["queue"]`, `["payout"]` and `["dashboard"]` prefixes. It runs after submit and save-draft (awaited before navigation), approve/send-back/reject (`useDecision.onSuccess`, then `mutateAsync` → navigate to `/approvals`), bulk approve, sample audit, comment, create batch and retry batch. Delegation invalidates only `["delegations"]`. Login and logout call `queryClient.clear()`, so no data carries over between users.

### 4. Forms and validation

All forms use react-hook-form with `zodResolver`. The claim schema in `lib/claim-rules.ts` mirrors README 4.2; the server stays the authority.

| README 4.2 | zod (`lineSchema` / `claimSchema`) |
|---|---|
| title, 1..20 lines | title trimmed 1–120 (the 120 is a client choice); `lines.min(1).max(20)` |
| category enum | `z.enum([MEALS,HOTEL,LOCAL_CAB,FLIGHT,TRAIN,OTHER])` |
| expenseDate not future, ≤ 90 days | `YYYY-MM-DD`, `≤ localToday()`, `≥ localDaysAgo(90)` (local date, not UTC) |
| amount > 0, ≤ 10,00,000, 2 decimals | `positive().max(1_000_000)` + `hasAtMost2Decimals` |
| vendor 1–120 | trimmed `min(1).max(120)` |
| city / nights required for HOTEL, nights 1–30 | `superRefine` on HOTEL; nights `int().min(1).max(30)`; city `max(80)` (client extra) |
| description ≤ 500, receiptId optional | same |
| total computed on server | the client sums lines only for display and the route preview |

The form validates on touch. `previewLine`/`predictRoute` show the policy outcome before submit (MISSING_RECEIPT → "Will be rejected", OVER_LIMIT, WEEKEND, NO_POLICY, auto-approve ≤ 5,000, and the manager/auditor/head chain) using `/api/policy-rules`. Server 400 `errors[]` are mapped back onto fields (`lines[0].amount` → `lines.0.amount`) with `setError`. The login form has its own small zod schema; Register user and Delegation also use RHF.

### 5. API client and error handling (`api/client.ts`, `endpoints.ts`)

`api<T>()` is the single transport. It uses relative `/api/...` URLs, adds `Authorization: Bearer` from `session`, and sends JSON or `FormData`. With `VITE_MOCK=1` it routes to `mock.ts`. `Api` has one function per OpenAPI operationId. A non-2xx response becomes an `ApiError` carrying the RFC 9457 problem, with `correlationId` filled from `X-Request-ID`. A network failure becomes `status 0`.

| Status | Behaviour |
|---|---|
| 401 | Any call except login runs the registered handler → `logout()` (clear storage + query cache) → `RequireAuth` sends the user to `/login`. The JWT expiry (stored `ef.exp`) also triggers logout with a "Session expired" toast. On login, a 401 shows "Email or password is incorrect". |
| 403 | No dedicated screen. Queries show `ErrorState` with the server's title/detail; mutations show `toastError`. |
| 404 | `ErrorState` shows "Not found" without a retry button (e.g. a colleague's claim); unknown routes → `NotFoundPage`. |
| 409 | Claim form: "This claim changed elsewhere — reload" toast (stale `version`). `/claims/:id/edit` on a non-editable status renders a 409-style `ErrorState`. |
| 413 / 415 | `ReceiptPicker` pre-checks ≤ 5 MB and JPEG/PNG/PDF (`accept` attributes too); otherwise the server's `detail` is shown inline on the line. |
| 429 | `toastError` → "Slow down" warning toast; login shows "Too many attempts". |
| other / 5xx | `ErrorState` (title, detail, `Ref <correlationId>`, Try again → `refetch`) or an error toast with the ref. |

### 6. Idempotency-Key and double-click guard

`newIdempotencyKey()` is `crypto.randomUUID()`. `ClaimForm` holds `createKey` and `submitKey` in `useRef`s, created once per form mount. They are reused on every retry, so a re-sent create/submit gets the same server response. Bulk approve and create batch keep their key in state and rotate it only after success. Submit is protected three ways:

1. `guarded()` sets a synchronous `lock` ref, so a second click in the same tick returns early (`setState` is async).
2. `busy` state disables both Submit and Save draft and shows a spinner.
3. The `Idempotency-Key` header lets the server deduplicate anything that still gets through.

After the first save, `history.replaceState` moves to `/claims/:id/edit`, so later saves `PUT` with `version`. E2E-03 checks that a double-click creates exactly one claim.

### 7. Responsive (375 px) and accessibility

**Responsive.** The layout is mobile-first Tailwind, with the main breakpoint at `lg`:
- Below `lg`, the sidebar becomes a `Drawer` and a sticky top bar appears. Below `md`, the claims list switches from table to cards, and below `sm` a floating "New claim" button replaces the header button.
- On mobile, the claim form summary and the Decision/Sample-audit bars are bars fixed to the bottom of the screen, padded for `safe-area-inset-bottom`; from `lg` they are sticky sidebars.
- On the approver view, the receipt viewer stacks above the lines on mobile and becomes a 2–3 column grid from `lg`/`xl`.
- Receipts can be captured with the camera (`capture="environment"`). The shell is `h-dvh` with `main#workspace` as the scroll container, reset to the top on each navigation.

**Accessibility.**
- Navigation is a `<nav aria-label="Main">` landmark. Page titles are `h1` in `PageHeader`.
- `Field` links each label to its input with `htmlFor` and announces errors with `role="alert"` (not linked by `aria-describedby`); inputs set `aria-invalid`. Category pickers are a `radiogroup`.
- `ErrorState` uses `role="alert"`; loading regions and busy buttons set `aria-busy`. Icon-only buttons have an `aria-label`.
- `Modal` provides a focus trap and Esc (base-ui). `:focus-visible` shows a 2 px outline. `prefers-reduced-motion` collapses animations.
- Light/dark/system themes are available. `data-testid` is set on every control the tests use.
