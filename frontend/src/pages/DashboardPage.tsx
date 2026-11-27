import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { AlertOctagon, ArrowDownRight, ArrowUpRight, ChevronRight, Clock3, Hourglass, Inbox, Wallet } from "lucide-react"
import type { DashboardSummary } from "@/api/types"
import { useDashboard } from "@/api/hooks"
import { HeaderActions } from "@/components/layout/AppShell"
import { Amount, CategoryIcon, EmptyState, ErrorState, PageHeader, Segmented, FlagChip } from "@/components/ds/domain"
import { Avatar, Card, CardHeader, CountUp, Skeleton } from "@/components/ds/primitives"
import { CATEGORY_COLOR, CATEGORY_LABEL, LEVEL_LABEL, hours, money0, moneyCompact } from "@/lib/format"
import { cn } from "@/lib/utils"

type Range = "3M" | "6M" | "12M"
const iso = (d: Date) => d.toISOString().slice(0, 10)
function rangeDates(r: Range) {
  const to = new Date()
  const from = new Date()
  from.setMonth(from.getMonth() - (r === "3M" ? 3 : r === "6M" ? 6 : 12))
  return { from: iso(from), to: iso(to) }
}

export default function DashboardPage() {
  const [range, setRange] = useState<Range>("12M")
  const { from, to } = useMemo(() => rangeDates(range), [range])
  const { data, isLoading, error, refetch } = useDashboard(from, to)

  return (
    <>
      <PageHeader title="Dashboard" sub="Spend, policy health and how fast approvals move." actions={<HeaderActions />}>
        <Segmented<Range> value={range} onChange={setRange} options={[{ value: "3M", label: "3 months" }, { value: "6M", label: "6 months" }, { value: "12M", label: "12 months" }]} />
      </PageHeader>
      {error ? (
        <ErrorState error={error} onRetry={refetch} className="py-24" />
      ) : isLoading || !data ? (
        <DashSkeleton />
      ) : (
        <Dash d={data} range={range} />
      )}
    </>
  )
}

function Dash({ d, range }: { d: DashboardSummary; range: Range }) {
  const months = d.spendByMonth.slice(range === "3M" ? -3 : range === "6M" ? -6 : -12)
  const pending = d.kpis.pendingByLevel.MANAGER + d.kpis.pendingByLevel.AUDITOR + d.kpis.pendingByLevel.HEAD
  const alert = (d.kpis.oldestPendingHours ?? 0) > 48

  return (
    <div className="grid gap-4 px-4 pt-5 pb-10 sm:px-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-4">
        {/* KPI strip */}
        <Card className="grid grid-cols-2 divide-line overflow-hidden md:grid-cols-4 md:divide-x [&>*]:border-line max-md:[&>*:nth-child(-n+2)]:border-b max-md:[&>*:nth-child(odd)]:border-r">
          <Kpi i={0} icon={<Inbox />} label="Pending approvals" value={<CountUp value={pending} />} sub={`${d.kpis.pendingByLevel.MANAGER} mgr · ${d.kpis.pendingByLevel.AUDITOR} aud · ${d.kpis.pendingByLevel.HEAD} head`} />
          <Kpi i={1} icon={<Hourglass />} label="Oldest pending" value={<span className={cn(alert && "text-danger")}>{hours(d.kpis.oldestPendingHours)}</span>} sub={alert ? <span className="inline-flex items-center gap-1 text-danger"><span className="size-1.5 animate-pulse-dot rounded-full bg-danger" />Above 48h alert</span> : "Within 48h target"} />
          <Kpi i={2} icon={<AlertOctagon />} label="Policy violations" value={<CountUp value={d.kpis.policyViolations} format={money0} />} sub="Flagged lines in period" />
          <Kpi i={3} icon={<Clock3 />} label="Avg approval time" value={hours(d.kpis.avgApprovalHours)} sub="Submit → final approval" />
        </Card>

        <SpendOverTime months={months} totalPaid={d.kpis.totalPaid} />

        <div className="grid gap-4 lg:grid-cols-2">
          <Exceptions d={d} />
          <Violations d={d} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <PendingByLevel d={d} />
        <CategoryBreakdown d={d} />
        <Departments d={d} />
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, icon, i }: { label: string; value: React.ReactNode; sub: React.ReactNode; icon: React.ReactNode; i: number }) {
  return (
    <div className="stagger p-4" style={{ "--i": i } as React.CSSProperties}>
      <div className="flex items-center gap-2 text-[12px] text-ink-3">
        <span className="text-ink-4 [&_svg]:size-3.5">{icon}</span>
        {label}
      </div>
      <p className="num mt-2 text-[24px] leading-none font-semibold tracking-[-0.025em]">{value}</p>
      <p className="mt-2 text-[12px] text-ink-3">{sub}</p>
    </div>
  )
}

/* ---------------------------------------------------------------- Spend over time (single series, no legend) */
function SpendOverTime({ months, totalPaid }: { months: DashboardSummary["spendByMonth"]; totalPaid: number }) {
  const data = months.map((m) => ({ ...m, label: new Date(m.month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short" }) }))
  const total = data.reduce((s, m) => s + m.amount, 0)
  const avg = total / Math.max(1, data.length)
  const last = data.at(-1)?.amount ?? 0
  const prev = data.at(-2)?.amount ?? last
  const delta = prev ? ((last - prev) / prev) * 100 : 0
  const up = delta >= 0

  return (
    <Card className="stagger overflow-hidden" style={{ "--i": 2 } as React.CSSProperties}>
      <CardHeader title="Approved spend over time" action={<span className="hidden text-[12px] text-ink-3 sm:inline">Approved · in payout · paid</span>} />
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-4">
        <div>
          <p className="text-[12px] text-ink-3">Spend in period</p>
          <p className="num mt-1 text-[30px] leading-none font-semibold tracking-[-0.03em]">
            <span className="mr-1 text-[18px] font-normal text-ink-3">₹</span>
            <CountUp value={total} format={money0} duration={900} />
          </p>
          <p className="mt-2 flex items-center gap-2 text-[12px] text-ink-3">
            <span className="size-2 rounded-[2px] bg-cobalt" /> Monthly spend
            <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium", up ? "bg-warning-soft text-warning" : "bg-positive-soft text-positive")}>
              {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
            vs last month
          </p>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-ink-3">Paid out all-time</p>
          <p className="num mt-1 text-[16px] font-medium">₹{moneyCompact(totalPaid)}</p>
        </div>
      </div>
      <div className="h-[260px] px-2 pt-2 pb-1" role="img" aria-label={`Monthly approved spend, ${data.length} months, average ₹${moneyCompact(avg)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cobalt)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--cobalt)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="0" />
            <XAxis dataKey="label" tickLine={{ stroke: "var(--line-strong)" }} axisLine={{ stroke: "var(--line-strong)" }} tick={{ fill: "var(--ink-3)", fontSize: 11.5 }} tickMargin={8} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v) => moneyCompact(v)} tick={{ fill: "var(--ink-3)", fontSize: 11.5 }} axisLine={false} tickLine={false} width={56} />
            <ReferenceLine y={avg} stroke="var(--ink-4)" strokeDasharray="4 4" label={{ value: `avg ₹${moneyCompact(avg)}`, position: "insideTopLeft", fill: "var(--ink-3)", fontSize: 11 }} />
            <Tooltip cursor={{ stroke: "var(--ink-4)", strokeDasharray: "3 3" }} content={<ChartTip />} />
            <Area type="monotone" dataKey="amount" stroke="var(--cobalt)" strokeWidth={2} fill="url(#spendFill)" activeDot={{ r: 5, strokeWidth: 3, stroke: "var(--surface)", fill: "var(--cobalt)" }} animationDuration={900} animationEasing="ease-out" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function ChartTip({ active, payload }: { active?: boolean; payload?: { payload: { month: string; amount: number } }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2 shadow-md">
      <p className="text-[11.5px] text-ink-3">{new Date(p.month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</p>
      <p className="num mt-0.5 text-[14px] font-semibold">₹{money0(p.amount)}</p>
    </div>
  )
}

/* ---------------------------------------------------------------- Right column */
function PendingByLevel({ d }: { d: DashboardSummary }) {
  const levels = (["MANAGER", "AUDITOR", "HEAD"] as const).map((l) => ({ l, n: d.kpis.pendingByLevel[l] }))
  const max = Math.max(1, ...levels.map((x) => x.n))
  return (
    <Card className="stagger" style={{ "--i": 3 } as React.CSSProperties}>
      <CardHeader title="Approval queues" action={<Link to="/approvals" className="text-[12px] text-ink-3 underline decoration-line-strong underline-offset-4 hover:text-ink">Open queue</Link>} />
      <ul className="flex flex-col gap-3.5 p-4">
        {levels.map(({ l, n }, i) => (
          <li key={l}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink-2">{LEVEL_LABEL[l]}</span>
              <span className="num font-medium">{n}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full origin-left animate-[grow_900ms_var(--ease-out)_both] rounded-full bg-obsidian" style={{ width: `${(n / max) * 100}%`, animationDelay: `${i * 80}ms` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function CategoryBreakdown({ d }: { d: DashboardSummary }) {
  const [hover, setHover] = useState<number | null>(null)
  const total = d.spendByCategory.reduce((s, c) => s + c.amount, 0)
  const data = d.spendByCategory.map((c) => ({ ...c, pct: (c.amount / total) * 100 }))
  const focus = hover != null ? data[hover] : null
  return (
    <Card className="stagger overflow-hidden" style={{ "--i": 4 } as React.CSSProperties}>
      <CardHeader title="Category breakdown" />
      <div className="relative mx-auto h-[200px] w-[200px] pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="amount" nameKey="category" innerRadius={68} outerRadius={88} paddingAngle={3} cornerRadius={5} stroke="var(--surface)" strokeWidth={2} startAngle={90} endAngle={-270} animationDuration={900} onMouseEnter={(_, i) => setHover(i)} onMouseLeave={() => setHover(null)}>
              {data.map((c, i) => (
                <Cell key={c.category} fill={CATEGORY_COLOR[c.category]} opacity={hover == null || hover === i ? 1 : 0.35} style={{ transition: "opacity 200ms", outline: "none" }} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center pt-3 text-center">
          <div>
            <p className="num text-[20px] leading-none font-semibold tracking-[-0.02em]">₹{moneyCompact(focus?.amount ?? total)}</p>
            <p className="mt-1 text-[11.5px] text-ink-3">{focus ? `${CATEGORY_LABEL[focus.category]} · ${focus.pct.toFixed(1)}%` : "Total spend"}</p>
          </div>
        </div>
      </div>
      <ul className="mt-2 flex flex-col px-2 pb-3">
        {data.map((c, i) => (
          <li key={c.category} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={cn("flex items-center gap-3 rounded-[10px] px-2 py-1.5 transition-colors", hover === i && "bg-surface-2")}>
            <CategoryIcon category={c.category} size={30} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{CATEGORY_LABEL[c.category]}</p>
              <p className="text-[11.5px] text-ink-3">{c.pct.toFixed(1)}% of spend</p>
            </div>
            <span className="num text-[13px] font-medium">₹{moneyCompact(c.amount)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Departments({ d }: { d: DashboardSummary }) {
  const max = Math.max(...d.spendByDepartment.map((x) => x.amount))
  return (
    <Card className="stagger" style={{ "--i": 5 } as React.CSSProperties}>
      <CardHeader title="Spend by department" />
      <ul className="flex flex-col gap-3 p-4">
        {[...d.spendByDepartment].sort((a, b) => b.amount - a.amount).map((x, i) => (
          <li key={x.departmentId} className="group" title={`${x.departmentName}: ₹${money0(x.amount)}`}>
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink-2">{x.departmentName}</span>
              <span className="num text-ink">₹{moneyCompact(x.amount)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full origin-left animate-[grow_900ms_var(--ease-out)_both] rounded-full bg-cobalt transition-opacity group-hover:opacity-80" style={{ width: `${(x.amount / max) * 100}%`, animationDelay: `${i * 70}ms` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ---------------------------------------------------------------- Bottom row */
function Exceptions({ d }: { d: DashboardSummary }) {
  return (
    <Card className="stagger overflow-hidden" style={{ "--i": 3 } as React.CSSProperties}>
      <CardHeader title="Oldest pending" sub="Waiting longest at any level" />
      {d.exceptions.length === 0 ? (
        <EmptyState icon={<Wallet />} title="Nothing waiting" body="Every claim has a decision." />
      ) : (
        <ul className="divide-y divide-line">
          {d.exceptions.slice(0, 6).map((c, i) => (
            <li key={c.id} className="stagger" style={{ "--i": i + 4 } as React.CSSProperties}>
              <Link to={`/claims/${c.id}`} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                <Avatar name={c.employeeName} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{c.title}</p>
                  <p className="text-[11.5px] text-ink-3">
                    {c.employeeName} · <span className={cn((c.waitingHours ?? 0) > 48 && "font-medium text-danger")}>{hours(c.waitingHours)}</span> at {c.currentLevel && LEVEL_LABEL[c.currentLevel].toLowerCase()}
                  </p>
                </div>
                <Amount value={c.totalAmount} size="sm" />
                <ChevronRight className="size-4 text-ink-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Violations({ d }: { d: DashboardSummary }) {
  const total = d.violationsByFlag.reduce((s, v) => s + v.count, 0)
  const max = Math.max(1, ...d.violationsByFlag.map((v) => v.count))
  return (
    <Card className="stagger overflow-hidden" style={{ "--i": 4 } as React.CSSProperties}>
      <CardHeader title="Violations by flag" sub={`${money0(total)} flagged lines`} />
      <ul className="flex flex-col gap-3.5 p-4">
        {[...d.violationsByFlag].sort((a, b) => b.count - a.count).map((v, i) => (
          <li key={v.flag} title={`${v.count} lines`}>
            <div className="flex items-center justify-between">
              <FlagChip flag={v.flag} />
              <span className="num text-[13px]">
                {v.count} <span className="text-ink-4">· {((v.count / total) * 100).toFixed(0)}%</span>
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full origin-left animate-[grow_900ms_var(--ease-out)_both] rounded-full bg-ink-2" style={{ width: `${(v.count / max) * 100}%`, animationDelay: `${i * 70}ms` }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-line bg-surface-2 px-4 py-2.5 text-[12px] text-ink-3">
        Flags route a line to a person; only a missing receipt auto-rejects.
      </div>
    </Card>
  )
}

function DashSkeleton() {
  return (
    <div className="grid gap-4 px-4 pt-5 sm:px-6 xl:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28 rounded-card" />
        <Skeleton className="h-[380px] rounded-card" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-card" />
          <Skeleton className="h-64 rounded-card" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-[420px] rounded-card" />
      </div>
    </div>
  )
}

