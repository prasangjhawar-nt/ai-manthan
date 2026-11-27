import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronRight, FileText, Plus, Search } from "lucide-react"
import type { ClaimStatus, ClaimSummary } from "@/api/types"
import { useMyClaims } from "@/api/hooks"
import { HeaderActions } from "@/components/layout/AppShell"
import { Amount, EmptyState, ErrorState, FlagList, PageHeader, Segmented, Stat, StatusBadge } from "@/components/ds/domain"
import { Button, CountUp, Input, Skeleton } from "@/components/ds/primitives"
import { date, money0, relative } from "@/lib/format"
import { cn } from "@/lib/utils"

type Tab = "ALL" | "DRAFT" | "REVIEW" | "ACTION" | "DONE"
const GROUPS: Record<Exclude<Tab, "ALL">, ClaimStatus[]> = {
  DRAFT: ["DRAFT"],
  REVIEW: ["SUBMITTED", "PENDING_MANAGER", "PENDING_AUDITOR", "PENDING_HEAD"],
  ACTION: ["NEEDS_CLARIFICATION"],
  DONE: ["APPROVED", "IN_PAYOUT", "PAID", "REJECTED"],
}

export default function ClaimsPage() {
  const { data, isLoading, error, refetch } = useMyClaims()
  const [tab, setTab] = useState<Tab>("ALL")
  const [q, setQ] = useState("")
  const nav = useNavigate()
  const all = useMemo(() => data?.content ?? [], [data])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return all.filter((c) => (tab === "ALL" || GROUPS[tab].includes(c.status)) && (!term || c.title.toLowerCase().includes(term) || c.claimNumber.toLowerCase().includes(term)))
  }, [all, tab, q])

  const count = (t: Exclude<Tab, "ALL">) => all.filter((c) => GROUPS[t].includes(c.status)).length
  const sum = (s: ClaimStatus[]) => all.filter((c) => s.includes(c.status)).reduce((a, c) => a + c.totalAmount, 0)

  return (
    <>
      <PageHeader title="My claims" sub="Everything you've submitted, and where it is right now." actions={<HeaderActions />} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line px-4 py-5 sm:px-6 md:grid-cols-4">
        {isLoading ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-28" />
            </div>
          ))
        ) : (
          <>
            <Stat style={{ "--i": 0 } as React.CSSProperties} label="In review" value={<Money v={sum(GROUPS.REVIEW)} />} sub={`${count("REVIEW")} claim${count("REVIEW") === 1 ? "" : "s"} moving through approval`} />
            <Stat style={{ "--i": 1 } as React.CSSProperties} label="Needs your attention" value={<span className={cn(count("ACTION") && "text-violet")}><CountUp value={count("ACTION") + count("DRAFT")} /></span>} sub={`${count("ACTION")} clarification · ${count("DRAFT")} draft`} />
            <Stat style={{ "--i": 2 } as React.CSSProperties} label="Approved, awaiting payout" value={<Money v={sum(["APPROVED", "IN_PAYOUT"])} />} sub="Paid in the next batch" />
            <Stat style={{ "--i": 3 } as React.CSSProperties} label="Reimbursed" value={<Money v={sum(["PAID"])} />} sub="Credited to your bank" />
          </>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "ALL", label: "All", count: all.length },
            { value: "DRAFT", label: "Drafts", count: count("DRAFT") },
            { value: "REVIEW", label: "In review", count: count("REVIEW") },
            { value: "ACTION", label: "Needs clarification", count: count("ACTION") },
            { value: "DONE", label: "Closed", count: count("DONE") },
          ]}
        />
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or number" className="h-9 pl-9" aria-label="Search claims" data-testid="claims-search" />
        </div>
      </div>

      <div className="px-4 pt-4 pb-24 sm:px-6 sm:pb-8">
        <div className="overflow-hidden rounded-card border border-line">
          {error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : isLoading ? (
            <LoadingRows />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title={all.length ? "Nothing in this view" : "No claims yet"}
              body={all.length ? "Try another tab or clear your search." : "Create your first claim — add lines, attach receipts, and we'll check policy for you."}
              action={!all.length && <Button variant="primary" onClick={() => nav("/claims/new")}><Plus /> New claim</Button>}
            />
          ) : (
            <>
              <ClaimTable rows={rows} />
              <ClaimCards rows={rows} />
            </>
          )}
        </div>
      </div>

      {/* Mobile FAB */}
      <Link
        to="/claims/new"
        className="fixed right-4 bottom-5 z-30 inline-flex h-12 animate-pop items-center gap-2 rounded-full bg-obsidian pr-5 pl-4 text-[14px] font-medium text-white shadow-lg active:scale-95 sm:hidden"
        data-testid="new-claim-fab"
      >
        <Plus className="size-5" /> New claim
      </Link>
    </>
  )
}

function Money({ v }: { v: number }) {
  return (
    <span className="num">
      <span className="mr-0.5 text-[16px] font-normal text-ink-3">₹</span>
      <CountUp value={v} format={money0} />
    </span>
  )
}

function ClaimTable({ rows }: { rows: ClaimSummary[] }) {
  const nav = useNavigate()
  return (
    <table className="hidden w-full text-left md:table">
      <thead>
        <tr className="border-b border-line bg-surface-2 text-[12px] text-ink-3">
          <th className="py-2.5 pl-4 font-medium">Claim</th>
          <th className="py-2.5 font-medium">Status</th>
          <th className="py-2.5 font-medium">Flags</th>
          <th className="py-2.5 font-medium">Submitted</th>
          <th className="py-2.5 pr-4 text-right font-medium">Amount</th>
          <th className="w-8" />
        </tr>
      </thead>
      <tbody>
        {rows.map((c, i) => (
          <tr
            key={c.id}
            onClick={() => nav(`/claims/${c.id}`)}
            className="stagger group cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-surface-2"
            style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
            data-testid={`claim-row-${c.id}`}
          >
            <td className="py-3 pl-4">
              <Link to={`/claims/${c.id}`} className="block font-medium text-ink outline-none" onClick={(e) => e.stopPropagation()}>
                {c.title}
              </Link>
              <span className="font-mono text-[11.5px] text-ink-3">{c.claimNumber}</span>
            </td>
            <td className="py-3">
              <StatusBadge status={c.status} />
            </td>
            <td className="py-3">
              <FlagList flags={c.flags} max={2} />
            </td>
            <td className="py-3 text-[13px] text-ink-2">{c.submittedAt ? date(c.submittedAt) : <span className="text-ink-4">Not yet</span>}</td>
            <td className="py-3 pr-4 text-right">
              <Amount value={c.totalAmount} />
            </td>
            <td className="pr-3">
              <ChevronRight className="size-4 text-ink-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink-2" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ClaimCards({ rows }: { rows: ClaimSummary[] }) {
  return (
    <ul className="divide-y divide-line md:hidden">
      {rows.map((c, i) => (
        <li key={c.id} className="stagger" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
          <Link to={`/claims/${c.id}`} className="flex flex-col gap-2 px-4 py-3.5 active:bg-surface-2" data-testid={`claim-card-${c.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.title}</p>
                <p className="font-mono text-[11.5px] text-ink-3">
                  {c.claimNumber} · {c.submittedAt ? relative(c.submittedAt) : "draft"}
                </p>
              </div>
              <Amount value={c.totalAmount} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={c.status} />
              {c.flags.length > 0 && <FlagList flags={c.flags} max={2} />}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function LoadingRows({ n = 5 }: { n?: number }) {
  return (
    <div className="divide-y divide-line" aria-busy>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="flex-1">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="hidden h-4 w-20 sm:block" />
        </div>
      ))}
    </div>
  )
}
