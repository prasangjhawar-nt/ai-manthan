# ExpenseFlow design system — "Stone & Obsidian"

Inspired by the Savexa finance dashboard. All values are tokens in `src/index.css`; never hard-code a colour in a page.

## Foundations
| Token | Value | Use |
|---|---|---|
| `canvas` | `#e9ebe7` | Outer frame + sidebar |
| `surface` / `surface-2` / `surface-3` | `#fff` / `#f6f7f5` / `#eceee9` | Workspace + cards / wells, table heads / hover, active nav |
| `line` / `line-strong` | `#e6e8e4` / `#d6d9d3` | Hairlines / inputs, outline buttons |
| `ink` → `ink-4` | `#131613` → `#9ca19a` | Text: primary, secondary, metadata, placeholder |
| `obsidian` | `#11231a` | Primary CTA, active tab pill, selection |
| `cobalt` | `#2e3fe5` | The one data accent (line chart, focus ring) |
| `positive / warning / danger / info / violet` (+ `-soft`) | | Status only — never for chart series |
| `cat-*` | hotel, flight, meals, cab, train, other | Category identity. Validated for colour-blind separation (dataviz validator). |

- **Type:** Geist (UI) + Geist Mono (claim/batch numbers). Scale 11.5 / 12 / 13 / 14 / 16 / 22 / 30. Section labels use `.eyebrow` (11.5px, uppercase, 0.06em).
- **Money:** always `<Amount>` — muted `₹`, Indian grouping, muted decimals, tabular numerals.
- **Radius:** panel 20 · card 14 · control 10 · chip 6. Borders over shadows; shadows only for floating UI.
- **Motion:** `rise` (8px fade-up) with `.stagger` + `--i`, sliding segmented pill, `CountUp` numbers, bars that `grow`, pulsing dot for anything waiting. 120–420ms, `cubic-bezier(.22,1,.36,1)`. All disabled under `prefers-reduced-motion`.

## Components (`src/components/ds`)
`Button` (primary · outline · soft · ghost · positive · danger · danger-soft), `Card` + `CardHeader`, `Badge`, `Chip`, `Input`, `Select`, `Textarea`, `Field`, `Checkbox`, `Switch`, `Avatar`, `Skeleton`, `CountUp`, `Modal` (bottom sheet on mobile), `Drawer`, `Segmented`, `StatusBadge`, `FlagChip`, `OutcomeChip`, `CategoryIcon`, `Amount`, `EmptyState`, `ErrorState` (shows correlation id + retry), `PageHeader`, `Stat`.

## Status language
| Status | Tone | Label |
|---|---|---|
| DRAFT, SUBMITTED | neutral | Draft / Submitted |
| PENDING_* | warning, pulsing | With manager / auditor / finance head |
| NEEDS_CLARIFICATION | violet | Needs clarification |
| APPROVED | positive | Approved |
| REJECTED | danger | Rejected |
| IN_PAYOUT | info, pulsing | In payout |
| PAID | ink | Paid |

## Running without the backend
`npm run dev:mock` serves the whole contract from `src/api/mock.ts` (stateful: policy engine, approval chain, delegation, bulk approve, flaky bank). `npm run dev` proxies `/api` to Prism/gateway as before.
