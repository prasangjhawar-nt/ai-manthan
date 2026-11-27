import { useMemo, useState } from "react"
import { ArrowRight, Check, MapPin, X } from "lucide-react"
import type { Category, Flag, PolicyConfig, PolicyRule } from "@/api/types"
import { usePolicy } from "@/api/hooks"
import { HeaderActions } from "@/components/layout/AppShell"
import { CategoryIcon, ErrorState, FlagChip, PageHeader } from "@/components/ds/domain"
import { Card, CardHeader, Input, Skeleton } from "@/components/ds/primitives"
import { CATEGORY_LABEL, money0 } from "@/lib/format"
import { approvalChain } from "@/lib/claim-rules"
import { cn } from "@/lib/utils"

const UNIT = { PER_DAY: "per day", PER_NIGHT: "per night", PER_TRIP: "per trip" } as const
const setting = (p: PolicyConfig, k: string, d: number) => Number(p.settings.find((s) => s.key === k)?.value ?? d)

export default function PolicyPage() {
  const { data, isLoading, error, refetch } = usePolicy()
  return (
    <>
      <PageHeader title="Expense policy" sub="What gets approved automatically, what needs a person, and who that person is. Read-only — finance owns these numbers." actions={<HeaderActions />} />
      {error ? (
        <ErrorState error={error} onRetry={refetch} className="py-24" />
      ) : isLoading || !data ? (
        <div className="flex flex-col gap-4 px-6 pt-5">
          <Skeleton className="h-56 rounded-card" />
          <Skeleton className="h-72 rounded-card" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-4 pt-5 pb-10 sm:px-6">
          <ThresholdRuler p={data} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <LimitsLedger p={data} />
            <LineChecks p={data} />
          </div>
        </div>
      )}
    </>
  )
}

/* ---------------------------------------------------------------- 1. Who approves — an interactive ruler */
function ThresholdRuler({ p }: { p: PolicyConfig }) {
  const auto = setting(p, "auto_approve.max_total", 5000)
  const aud = setting(p, "approval.auditor.above", 25000)
  const head = setting(p, "approval.head.above", 100000)
  const [raw, setRaw] = useState("30500")
  const amount = Number(raw.replace(/[^\d.]/g, "")) || 0

  // Equal-width bands, linear inside each band; the last band shows up to 2× the head threshold.
  const bands = [
    { from: 0, to: auto, label: "Auto-approve", sub: `≤ ₹${money0(auto)}, every line clean`, who: [] as string[] },
    { from: auto, to: aud, label: "Manager", sub: `up to ₹${money0(aud)}`, who: ["Manager"] },
    { from: aud, to: head, label: "+ Auditor", sub: `above ₹${money0(aud)}`, who: ["Manager", "Auditor"] },
    { from: head, to: head * 2, label: "+ Finance head", sub: `above ₹${money0(head)}`, who: ["Manager", "Auditor", "Finance head"] },
  ]
  const pos = useMemo(() => {
    const i = bands.findIndex((b) => amount <= b.to)
    const idx = i === -1 ? bands.length - 1 : i
    const b = bands[idx]
    const t = Math.min(1, Math.max(0, (amount - b.from) / (b.to - b.from)))
    return { idx, pct: ((idx + (i === -1 ? 1 : t)) / bands.length) * 100 }
  }, [amount, auto, aud, head])
  const chain = amount > auto ? approvalChain(amount, p).steps : []

  return (
    <Card className="stagger overflow-hidden" style={{ "--i": 0 } as React.CSSProperties}>
      <CardHeader title="Who approves a claim" sub="Thresholds are strict: exactly ₹25,000 stops at the manager." />
      <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-center">
        <div>
          <label htmlFor="try-amount" className="text-[12.5px] font-medium text-ink-2">Try a claim total</label>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[16px] text-ink-3">₹</span>
            <Input id="try-amount" inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)} className="num h-12 pl-8 text-[20px] font-semibold tracking-[-0.02em]" data-testid="policy-try-amount" />
          </div>
          <div className="mt-3 flex min-h-7 flex-wrap items-center gap-1.5 text-[12.5px]" aria-live="polite">
            {amount <= 0 ? (
              <span className="text-ink-3">Enter an amount</span>
            ) : chain.length === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-positive-soft px-2.5 py-1 font-medium text-positive">
                <Check className="size-3.5" /> No approver if every line is clean
              </span>
            ) : (
              chain.map((s, i) => (
                <span key={s} className="flex animate-pop items-center gap-1.5" style={{ animationDelay: `${i * 60}ms` }}>
                  {i > 0 && <ArrowRight className="size-3.5 text-ink-4" />}
                  <span className="rounded-full border border-line bg-surface px-2.5 py-1 font-medium text-ink">{s}</span>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="pt-6">
          <div className="relative">
            {/* marker */}
            <div className="absolute -top-7 z-10 -translate-x-1/2 transition-[left] duration-500 ease-out-quint" style={{ left: `${pos.pct}%` }} aria-hidden>
              <div className="num rounded-md bg-ink px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-surface">₹{money0(amount)}</div>
              <div className="mx-auto h-3 w-px bg-ink" />
            </div>
            <div className="grid grid-cols-4 gap-[3px] overflow-hidden rounded-full">
              {bands.map((b, i) => (
                <div key={b.label} className={cn("h-2.5 transition-colors duration-300", i === 0 ? "bg-positive/70" : i <= pos.idx ? "bg-ink" : "bg-surface-3", i === 0 && pos.idx > 0 && "bg-positive/35")} />
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
            {bands.map((b, i) => (
              <div key={b.label} className={cn("border-l-2 pl-2.5 transition-colors duration-300", i === pos.idx ? "border-ink" : "border-line")}>
                <p className={cn("text-[13px] font-medium", i === pos.idx ? "text-ink" : "text-ink-2")}>{b.label}</p>
                <p className="text-[11.5px] text-ink-3">{b.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-[12px] text-ink-3 sm:px-5">
        Nobody approves their own claim. A claim sent back for clarification restarts at the manager when resubmitted.
      </p>
    </Card>
  )
}

/* ---------------------------------------------------------------- 2. Limits — a ledger, not cards */
function LimitsLedger({ p }: { p: PolicyConfig }) {
  const byCat = new Map<Category, PolicyRule[]>()
  for (const r of p.rules) byCat.set(r.category, [...(byCat.get(r.category) ?? []), r])
  const noPolicy: Category[] = (["FLIGHT", "TRAIN", "OTHER"] as Category[]).filter((c) => !byCat.has(c))
  const receiptAbove = setting(p, "receipt.required.above", 500)
  let row = 0

  return (
    <Card className="stagger self-start overflow-hidden" style={{ "--i": 1 } as React.CSSProperties}>
      <CardHeader title="Spending limits" sub={`Receipt required for any line above ₹${money0(receiptAbove)}`} />
      <table className="w-full text-left">
        <thead className="sr-only">
          <tr><th>Category</th><th>Rule</th><th>Limit</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...byCat.entries()].map(([cat, rules]) =>
            rules.map((r, j) => (
              <tr key={r.id} className="stagger transition-colors hover:bg-surface-2" style={{ "--i": row++ + 2 } as React.CSSProperties}>
                <td className="w-14 py-3 pr-3 pl-4 align-top">{j === 0 && <CategoryIcon category={cat} size={32} />}</td>
                <td className="py-3 pr-3">
                  <p className="text-[13.5px] font-medium">
                    {j === 0 ? CATEGORY_LABEL[cat] : <span className="text-ink-3">{CATEGORY_LABEL[cat]}</span>}
                    {r.cityTier != null && <span className={cn("ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-medium", r.cityTier === 1 ? "bg-cobalt-soft text-cobalt" : "bg-surface-3 text-ink-2")}>{r.cityTier === 1 ? "Tier-1 city" : "Other cities"}</span>}
                    {!r.active && <span className="ml-2 text-[11px] text-ink-4">inactive</span>}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-4">{r.code}</p>
                </td>
                <td className="py-3 pr-4 text-right align-top whitespace-nowrap">
                  <span className="num text-[16px] font-semibold tracking-[-0.01em]">₹{money0(r.limitAmount)}</span>
                  <span className="block text-[11.5px] text-ink-3">{UNIT[r.unit]}</span>
                </td>
              </tr>
            )),
          )}
          {noPolicy.map((cat) => (
            <tr key={cat} className="stagger" style={{ "--i": row++ + 2 } as React.CSSProperties}>
              <td className="w-14 py-3 pr-3 pl-4"><CategoryIcon category={cat} size={32} /></td>
              <td className="py-3 pr-3 text-[13.5px] font-medium">{CATEGORY_LABEL[cat]}</td>
              <td className="py-3 pr-4 text-right text-[12.5px] text-ink-3">No limit · always reviewed</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-line px-4 py-3">
        <p className="mb-2 text-[12px] text-ink-3">Tier-1 cities</p>
        <div className="flex flex-wrap gap-1.5">
          {p.tier1Cities.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[12px] text-ink-2">
              <MapPin className="size-3 text-ink-4" /> {c}
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}

/* ---------------------------------------------------------------- 3. Checks on every line */
function LineChecks({ p }: { p: PolicyConfig }) {
  const receiptAbove = setting(p, "receipt.required.above", 500)
  const rate = Math.round(setting(p, "sample_audit.rate", 0.1) * 100)
  const alertH = setting(p, "alert.oldest_pending.hours", 48)
  const checks: { flag: Flag; when: string; result: "reject" | "route" }[] = [
    { flag: "MISSING_RECEIPT", when: `Amount above ₹${money0(receiptAbove)} with no receipt attached`, result: "reject" },
    { flag: "OVER_LIMIT", when: "Above the category limit (hotel is checked per night)", result: "route" },
    { flag: "DUPLICATE", when: "Same vendor, amount and date — or the same receipt file — as an earlier claim", result: "route" },
    { flag: "WEEKEND", when: "Spent on a Saturday or Sunday", result: "route" },
    { flag: "NO_POLICY", when: "Category has no auto-approve rule (flight, train, other)", result: "route" },
  ]
  return (
    <Card className="stagger self-start overflow-hidden" style={{ "--i": 2 } as React.CSSProperties}>
      <CardHeader title="Checks on every line" sub="Run when you submit, and again on every resubmission" />
      <ul className="divide-y divide-line">
        {checks.map((c, i) => (
          <li key={c.flag} className="stagger flex items-start gap-3 px-4 py-3" style={{ "--i": i + 3 } as React.CSSProperties}>
            <div className="w-[104px] shrink-0 pt-0.5"><FlagChip flag={c.flag} /></div>
            <p className="flex-1 text-[13px] leading-snug text-ink-2">{c.when}</p>
            <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium", c.result === "reject" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
              {c.result === "reject" ? <X className="size-3" /> : <ArrowRight className="size-3" />}
              {c.result === "reject" ? "Rejects" : "To a person"}
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 border-t border-line bg-surface-2 text-[12px]">
        <div className="border-r border-line px-4 py-3">
          <dt className="text-ink-3">Random sample audit</dt>
          <dd className="num mt-0.5 text-[15px] font-semibold text-ink">{rate}%</dd>
          <dd className="text-ink-3">of auto-approved claims</dd>
        </div>
        <div className="px-4 py-3">
          <dt className="text-ink-3">Escalation alert</dt>
          <dd className="num mt-0.5 text-[15px] font-semibold text-ink">{alertH}h</dd>
          <dd className="text-ink-3">oldest pending approval</dd>
        </div>
      </dl>
    </Card>
  )
}
