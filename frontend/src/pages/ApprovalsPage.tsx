import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { CheckCheck, ChevronRight, Inbox, SlidersHorizontal, X, CircleCheck, CircleSlash, ArrowUpRight } from "lucide-react"
import type { Category, ClaimSummary, Flag, QueueFilters } from "@/api/types"
import { CATEGORIES, FLAGS } from "@/api/types"
import { Api } from "@/api/endpoints"
import { newIdempotencyKey } from "@/api/client"
import { useDashboard, useInvalidateClaims, useQueue, toastError } from "@/api/hooks"
import { useAuth } from "@/lib/auth"
import { HeaderActions } from "@/components/layout/AppShell"
import { Amount, EmptyState, ErrorState, FlagList, PageHeader, Stat, StatusBadge } from "@/components/ds/domain"
import { Avatar, Button, Checkbox, CountUp, Input, Select, Textarea } from "@/components/ds/primitives"
import { Modal } from "@/components/ds/dialog"
import { CATEGORY_LABEL, FLAG_LABEL, hours, money, money0 } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LoadingRows } from "./ClaimsPage"

const SUB = {
  MANAGER: "Claims from your team — and anyone who delegated to you — waiting on your call. Oldest first.",
  AUDITOR: "Claims above ₹25,000 and random sample audits. Filter, review, bulk approve.",
  HEAD: "Claims above ₹1,00,000 that need the finance head's sign-off.",
} as const

export default function ApprovalsPage() {
  const { user } = useAuth()
  const isAuditor = user?.role === "AUDITOR"
  const [filters, setFilters] = useState<QueueFilters>({})
  const [showFilters, setShowFilters] = useState(false)
  const { data, isLoading, error, refetch, isFetching } = useQueue(filters)
  const rows = useMemo(() => data?.content ?? [], [data])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const selectable = rows.filter((r) => r.status === "PENDING_AUDITOR")
  const selRows = rows.filter((r) => selected.has(r.id))
  const activeFilterCount = Object.values(filters).filter((v) => v !== undefined && v !== "" && v !== false).length

  const set = (patch: Partial<QueueFilters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setSelected(new Set())
  }

  const oldest = Math.max(0, ...rows.map((r) => r.waitingHours ?? 0))
  const total = rows.reduce((s, r) => s + r.totalAmount, 0)
  const flagged = rows.filter((r) => r.flags.length).length

  return (
    <>
      <PageHeader title="Approvals" sub={user && user.role !== "EMPLOYEE" ? SUB[user.role] : undefined} actions={<HeaderActions />} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line px-4 py-5 sm:px-6 md:grid-cols-4">
        <Stat style={{ "--i": 0 } as React.CSSProperties} label="Waiting on you" value={<CountUp value={data?.totalElements ?? 0} />} sub={isLoading ? " " : `${flagged} with policy flags`} />
        <Stat style={{ "--i": 1 } as React.CSSProperties} label="Value in queue" value={<span className="num"><span className="mr-0.5 text-[16px] font-normal text-ink-3">₹</span><CountUp value={total} format={money0} /></span>} />
        <Stat style={{ "--i": 2 } as React.CSSProperties} label="Oldest waiting" value={<span className={cn(oldest > 48 && "text-danger")}>{rows.some((r) => r.waitingHours != null) ? hours(oldest) : "—"}</span>} sub={oldest > 48 ? "Over the 48h alert threshold" : "Within target"} />
        <Stat style={{ "--i": 3 } as React.CSSProperties} label="Target per decision" value="< 30s" sub="Receipts and flags side by side" />
      </div>

      {/* Quick flag filter + filter toggle */}
      <div className="flex flex-col gap-3 px-4 pt-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="no-scrollbar flex flex-1 gap-1.5 overflow-x-auto">
            <FilterPill on={!filters.flag && !filters.sampleAuditOnly} onClick={() => set({ flag: undefined, sampleAuditOnly: undefined })}>All</FilterPill>
            {FLAGS.map((f) => (
              <FilterPill key={f} on={filters.flag === f} onClick={() => set({ flag: filters.flag === f ? undefined : f })} testId={`filter-flag-${f}`}>
                {FLAG_LABEL[f]}
              </FilterPill>
            ))}
            {isAuditor && (
              <FilterPill on={!!filters.sampleAuditOnly} onClick={() => set({ sampleAuditOnly: !filters.sampleAuditOnly || undefined })}>Sample audits</FilterPill>
            )}
          </div>
          <Button size="sm" variant={showFilters || activeFilterCount ? "soft" : "outline"} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} data-testid="toggle-filters">
            <SlidersHorizontal /> Filters
            {activeFilterCount > 0 && <span className="num rounded-full bg-obsidian px-1.5 text-[11px] leading-[18px] text-white">{activeFilterCount}</span>}
          </Button>
        </div>
        <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out-quint", showFilters ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
          <div className="overflow-hidden">
            <FilterPanel filters={filters} set={set} showDept={isAuditor || user?.role === "HEAD"} onClear={() => { setFilters({}); setSelected(new Set()) }} />
          </div>
        </div>
      </div>

      <div className={cn("px-4 pt-4 pb-28 transition-opacity sm:px-6", isFetching && !isLoading && "opacity-70")}>
        <div className="overflow-hidden rounded-card border border-line">
          {error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : isLoading ? (
            <LoadingRows />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Inbox />} title={activeFilterCount ? "No claims match these filters" : "You're all caught up"} body={activeFilterCount ? "Loosen a filter to see more." : "New claims will show up here as soon as they're submitted."} />
          ) : (
            <QueueTable
              rows={rows}
              selectable={isAuditor}
              selected={selected}
              allSelected={selectable.length > 0 && selectable.every((r) => selected.has(r.id))}
              onToggleAll={(v) => setSelected(v ? new Set(selectable.map((r) => r.id)) : new Set())}
              onToggle={(id, v) =>
                setSelected((s) => {
                  const n = new Set(s)
                  if (v) n.add(id)
                  else n.delete(id)
                  return n
                })
              }
            />
          )}
        </div>
      </div>

      {isAuditor && <BulkBar rows={selRows} onClear={() => setSelected(new Set())} onDone={() => setSelected(new Set())} />}
    </>
  )
}

function FilterPill({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      data-testid={testId}
      className={cn("h-8 shrink-0 rounded-full border px-3 text-[12.5px] font-medium transition-all duration-150 active:scale-95", on ? "border-obsidian bg-obsidian text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink")}
    >
      {children}
    </button>
  )
}

function FilterPanel({ filters, set, showDept, onClear }: { filters: QueueFilters; set: (p: Partial<QueueFilters>) => void; showDept: boolean; onClear: () => void }) {
  const dash = useDashboard()
  const departments = dash.data?.spendByDepartment ?? []
  return (
    <div className="grid grid-cols-2 gap-3 rounded-card border border-line bg-surface-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
      {showDept && (
        <Select aria-label="Department" value={filters.departmentId ?? ""} onChange={(e) => set({ departmentId: e.target.value ? Number(e.target.value) : undefined })} className="h-9 text-[13px]" data-testid="filter-department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.departmentId} value={d.departmentId}>{d.departmentName}</option>)}
        </Select>
      )}
      <Select aria-label="Category" value={filters.category ?? ""} onChange={(e) => set({ category: (e.target.value || undefined) as Category | undefined })} className="h-9 text-[13px]" data-testid="filter-category">
        <option value="">All categories</option>
        {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
      </Select>
      <Select aria-label="Flag" value={filters.flag ?? ""} onChange={(e) => set({ flag: (e.target.value || undefined) as Flag | undefined })} className="h-9 text-[13px]">
        <option value="">Any flag</option>
        {FLAGS.map((f) => <option key={f} value={f}>{FLAG_LABEL[f]}</option>)}
      </Select>
      <Input aria-label="Minimum amount" type="number" inputMode="numeric" placeholder="Min ₹" value={filters.minAmount ?? ""} onChange={(e) => set({ minAmount: e.target.value ? Number(e.target.value) : undefined })} className="h-9 text-[13px]" data-testid="filter-min" />
      <Input aria-label="Maximum amount" type="number" inputMode="numeric" placeholder="Max ₹" value={filters.maxAmount ?? ""} onChange={(e) => set({ maxAmount: e.target.value ? Number(e.target.value) : undefined })} className="h-9 text-[13px]" data-testid="filter-max" />
      <Button size="sm" variant="ghost" onClick={onClear} className="h-9 justify-self-start">
        <X /> Clear all
      </Button>
    </div>
  )
}

function Waiting({ h }: { h: number | null }) {
  if (h == null) return <span className="text-ink-4">—</span>
  const pct = Math.min(100, (h / 72) * 100)
  const color = h > 48 ? "bg-danger" : h > 24 ? "bg-warning" : "bg-positive"
  return (
    <div className="flex items-center gap-2">
      <span className={cn("num w-12 text-[13px]", h > 48 ? "font-medium text-danger" : "text-ink-2")}>{hours(h)}</span>
      <span className="hidden h-1 w-14 overflow-hidden rounded-full bg-surface-3 lg:block">
        <span className={cn("block h-full rounded-full transition-[width] duration-700 ease-out-quint", color)} style={{ width: `${pct}%` }} />
      </span>
    </div>
  )
}

function QueueTable({ rows, selectable, selected, allSelected, onToggleAll, onToggle }: { rows: ClaimSummary[]; selectable: boolean; selected: Set<number>; allSelected: boolean; onToggleAll: (v: boolean) => void; onToggle: (id: number, v: boolean) => void }) {
  const nav = useNavigate()
  const some = selected.size > 0 && !allSelected
  return (
    <>
      <table className="hidden w-full text-left md:table">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-[12px] text-ink-3">
            {selectable && (
              <th className="w-10 py-2.5 pl-4">
                <Checkbox checked={allSelected} indeterminate={some} onChange={onToggleAll} label="Select all" data-testid="select-all" />
              </th>
            )}
            <th className={cn("py-2.5 font-medium", !selectable && "pl-4")}>Claim</th>
            <th className="py-2.5 font-medium">Employee</th>
            <th className="py-2.5 font-medium">Flags</th>
            <th className="py-2.5 font-medium">Waiting</th>
            <th className="py-2.5 pr-4 text-right font-medium">Amount</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const canSel = selectable && c.status === "PENDING_AUDITOR"
            const sel = selected.has(c.id)
            return (
              <tr
                key={c.id}
                onClick={() => nav(`/approvals/${c.id}`)}
                className={cn("stagger group cursor-pointer border-b border-line transition-colors duration-150 last:border-0", sel ? "bg-cobalt-soft/50" : "hover:bg-surface-2")}
                style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
                data-testid={`queue-row-${c.id}`}
              >
                {selectable && (
                  <td className="py-3 pl-4">{canSel ? <Checkbox checked={sel} onChange={(v) => onToggle(c.id, v)} label={`Select ${c.claimNumber}`} data-testid={`select-${c.id}`} /> : null}</td>
                )}
                <td className={cn("py-3", !selectable && "pl-4")}>
                  <Link to={`/approvals/${c.id}`} onClick={(e) => e.stopPropagation()} className="block font-medium">
                    {c.title}
                  </Link>
                  <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-ink-3">
                    {c.claimNumber}
                    {c.sampleAudit === "OPEN" && <span className="rounded bg-info-soft px-1 font-sans text-[10.5px] font-medium text-info">Sample audit</span>}
                  </span>
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={c.employeeName} size={26} />
                    <div className="leading-tight">
                      <p className="text-[13px]">{c.employeeName}</p>
                      <p className="text-[11.5px] text-ink-3">{c.departmentName}</p>
                    </div>
                  </div>
                </td>
                <td className="py-3"><FlagList flags={c.flags} max={2} /></td>
                <td className="py-3"><Waiting h={c.waitingHours} /></td>
                <td className="py-3 pr-4 text-right"><Amount value={c.totalAmount} /></td>
                <td className="pr-3"><ChevronRight className="size-4 text-ink-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink-2" /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ul className="divide-y divide-line md:hidden">
        {rows.map((c, i) => (
          <li key={c.id} className="stagger flex items-start gap-3 px-4 py-3.5" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
            {selectable && c.status === "PENDING_AUDITOR" && <Checkbox className="mt-1" checked={selected.has(c.id)} onChange={(v) => onToggle(c.id, v)} label={`Select ${c.claimNumber}`} />}
            <Link to={`/approvals/${c.id}`} className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.title}</p>
                  <p className="text-[12px] text-ink-3">{c.employeeName} · waiting {hours(c.waitingHours)}</p>
                </div>
                <Amount value={c.totalAmount} />
              </div>
              <FlagList flags={c.flags} />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

function BulkBar({ rows, onClear, onDone }: { rows: ClaimSummary[]; onClear: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [comment, setComment] = useState("")
  const [key, setKey] = useState(newIdempotencyKey)
  const invalidate = useInvalidateClaims()
  const m = useMutation({
    mutationFn: () => Api.bulkApprove(rows.map((r) => r.id), comment.trim() || null, key),
    onSuccess: (res) => {
      invalidate()
      setKey(newIdempotencyKey())
      setComment("")
      if (res.failed) toast.warning(`${res.succeeded} approved, ${res.failed} skipped`, { description: res.results.filter((r) => r.outcome === "SKIPPED").map((r) => `${r.claimNumber ?? r.claimId}: ${r.errorDetail}`).join(" · ") })
      else toast.success(`${res.succeeded} claims approved`, { description: res.results.some((r) => r.outcome === "PENDING_HEAD") ? "Claims above ₹1,00,000 moved to the finance head." : "All are now eligible for payout." })
    },
    onError: (e) => toastError(e, "Bulk approve failed"),
  })
  const total = rows.reduce((s, r) => s + r.totalAmount, 0)
  const toHead = rows.filter((r) => r.totalAmount > 100000).length
  const res = m.data

  return (
    <>
      {rows.length > 0 && (
        <div className="fixed bottom-5 left-1/2 z-30 flex w-[calc(100%-2rem)] max-w-[560px] animate-slide-up items-center gap-3 rounded-[16px] bg-obsidian py-2.5 pr-2.5 pl-4 text-white shadow-lg lg:left-[calc(50%+116px)]" role="region" aria-label="Bulk actions">
          <span className="grid size-7 place-items-center rounded-full bg-white/15 font-mono text-[12px]">{rows.length}</span>
          <div className="min-w-0 flex-1 text-[13px] leading-tight">
            <p className="font-medium">selected</p>
            <p className="num text-white/60">₹{money(total)}</p>
          </div>
          <Button size="sm" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white" onClick={onClear}>Clear</Button>
          <Button size="md" className="border-transparent bg-white text-obsidian hover:bg-white/90" onClick={() => setConfirm(true)} data-testid="bulk-approve">
            <CheckCheck /> Bulk approve
          </Button>
        </div>
      )}
      <Modal
        open={confirm}
        onOpenChange={(o) => {
          setConfirm(o)
          if (!o && res) {
            m.reset()
            onDone()
          }
        }}
        title={res ? "Bulk approve results" : `Approve ${rows.length} claims?`}
        description={res ? `${res.processed} processed · ${res.succeeded} succeeded · ${res.failed} skipped` : toHead ? `${toHead} of these are above ₹1,00,000 and will go to the finance head.` : "Each claim is processed on its own. Anything not in your queue is skipped."}
        footer={
          res ? (
            <Button variant="primary" onClick={() => { setConfirm(false); m.reset(); onDone() }}>Done</Button>
          ) : (
            <>
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="positive" loading={m.isPending} onClick={() => m.mutate()} data-testid="confirm-bulk">
                <CheckCheck /> Approve {rows.length} · ₹{money0(total)}
              </Button>
            </>
          )
        }
      >
        {res ? (
          <ul className="divide-y divide-line rounded-[10px] border border-line">
            {res.results.map((r, i) => (
              <li key={r.claimId} className="stagger flex items-center gap-3 px-3 py-2.5 text-[13px]" style={{ "--i": i } as React.CSSProperties}>
                {r.outcome === "SKIPPED" ? <CircleSlash className="size-4 text-danger" /> : r.outcome === "PENDING_HEAD" ? <ArrowUpRight className="size-4 text-warning" /> : <CircleCheck className="size-4 text-positive" />}
                <span className="font-mono text-[12px]">{r.claimNumber ?? r.claimId}</span>
                <span className="ml-auto text-right text-[12px] text-ink-3">{r.outcome === "SKIPPED" ? `${r.errorStatus} · ${r.errorDetail}` : r.newStatus && <StatusBadge status={r.newStatus} />}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="scroll-thin max-h-48 divide-y divide-line overflow-y-auto rounded-[10px] border border-line">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="truncate">{r.title} <span className="font-mono text-[11.5px] text-ink-3">{r.claimNumber}</span></span>
                  <Amount value={r.totalAmount} size="sm" />
                </li>
              ))}
            </ul>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment, e.g. “Reviewed in batch.”" aria-label="Comment" rows={2} />
          </div>
        )}
      </Modal>
    </>
  )
}

