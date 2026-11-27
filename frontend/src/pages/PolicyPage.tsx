import { MapPin, Receipt, Route, Shuffle, Zap } from "lucide-react"
import type { PolicyRule } from "@/api/types"
import { usePolicy } from "@/api/hooks"
import { HeaderActions } from "@/components/layout/AppShell"
import { CategoryIcon, ErrorState, PageHeader } from "@/components/ds/domain"
import { Card, CardHeader, Skeleton } from "@/components/ds/primitives"
import { CATEGORY_LABEL, money0 } from "@/lib/format"

const UNIT = { PER_DAY: "per day", PER_NIGHT: "per night", PER_TRIP: "per trip" } as const
const SETTING_ICON: Record<string, React.ReactNode> = {
  "receipt.required.above": <Receipt />,
  "auto_approve.max_total": <Zap />,
  "approval.auditor.above": <Route />,
  "approval.head.above": <Route />,
  "sample_audit.rate": <Shuffle />,
}

export default function PolicyPage() {
  const { data, isLoading, error, refetch } = usePolicy()
  return (
    <>
      <PageHeader title="Expense policy" sub="The rules every line is checked against. Read-only — finance owns the configuration." actions={<HeaderActions />} />
      {error ? (
        <ErrorState error={error} onRetry={refetch} className="py-24" />
      ) : isLoading || !data ? (
        <div className="grid gap-4 px-6 pt-5 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}</div>
      ) : (
        <div className="grid gap-4 px-4 pt-5 pb-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-4">
            <h2 className="eyebrow">Spending limits</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.rules.map((r, i) => <RuleCard key={r.id} r={r} i={i} />)}
            </div>
            <Card className="stagger" style={{ "--i": 5 } as React.CSSProperties}>
              <CardHeader title="How a claim is decided" />
              <ol className="grid gap-4 p-4 sm:grid-cols-3">
                {[
                  ["Every line is checked", "Limits, weekends, duplicates and receipts. A missing receipt above the threshold auto-rejects the claim."],
                  ["Clean & small → auto-approved", "If every line is clean and the total is within the auto-approve limit, no one needs to look at it."],
                  ["Otherwise, a chain of people", "Manager first; auditor above ₹25,000; finance head above ₹1,00,000. Nobody approves their own claim."],
                ].map(([t, b], i) => (
                  <li key={t}>
                    <span className="grid size-6 place-items-center rounded-full bg-obsidian font-mono text-[11px] text-white">{i + 1}</span>
                    <p className="mt-2 text-[13.5px] font-medium">{t}</p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{b}</p>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
          <div className="flex flex-col gap-4">
            <Card className="stagger overflow-hidden" style={{ "--i": 2 } as React.CSSProperties}>
              <CardHeader title="Thresholds" />
              <ul className="divide-y divide-line">
                {data.settings.map((s) => (
                  <li key={s.key} className="flex items-center gap-3 px-4 py-3">
                    <span className="grid size-8 place-items-center rounded-lg bg-surface-2 text-ink-3 [&_svg]:size-4">{SETTING_ICON[s.key] ?? <Zap />}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">{s.description ?? s.key}</p>
                      <p className="font-mono text-[11px] text-ink-4">{s.key}</p>
                    </div>
                    <span className="num text-[14px] font-semibold">{fmtSetting(s.key, s.value)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="stagger" style={{ "--i": 3 } as React.CSSProperties}>
              <CardHeader title="Tier-1 cities" sub="Higher hotel limit applies" />
              <div className="flex flex-wrap gap-1.5 p-4">
                {data.tier1Cities.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] text-ink-2">
                    <MapPin className="size-3 text-ink-4" /> {c}
                  </span>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

function fmtSetting(key: string, v: string) {
  if (key.endsWith(".rate")) return `${Math.round(Number(v) * 100)}%`
  if (key.endsWith(".hours")) return `${v}h`
  return `₹${money0(Number(v))}`
}

function RuleCard({ r, i }: { r: PolicyRule; i: number }) {
  return (
    <Card className="stagger p-4 transition-shadow duration-200 hover:shadow-md" style={{ "--i": i } as React.CSSProperties}>
      <div className="flex items-start justify-between">
        <CategoryIcon category={r.category} size={36} />
        <span className={r.active ? "text-[11.5px] font-medium text-positive" : "text-[11.5px] text-ink-4"}>{r.active ? "Active" : "Off"}</span>
      </div>
      <p className="mt-3 text-[13px] text-ink-3">
        {CATEGORY_LABEL[r.category]}
        {r.cityTier != null && ` · ${r.cityTier === 1 ? "tier-1 city" : "other cities"}`}
      </p>
      <p className="num mt-0.5 text-[22px] font-semibold tracking-[-0.02em]">
        ₹{money0(r.limitAmount)} <span className="text-[13px] font-normal text-ink-3">{UNIT[r.unit]}</span>
      </p>
      <p className="mt-1 font-mono text-[11px] text-ink-4">{r.code}</p>
    </Card>
  )
}
