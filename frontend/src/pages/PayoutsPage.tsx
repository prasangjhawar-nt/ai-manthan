import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, Landmark, RefreshCcw, Banknote, CheckCircle2, Layers } from "lucide-react"
import type { PayoutBatch } from "@/api/types"
import { Api } from "@/api/endpoints"
import { newIdempotencyKey } from "@/api/client"
import { useBatches, useEligible, useInvalidateClaims, toastError } from "@/api/hooks"
import { HeaderActions } from "@/components/layout/AppShell"
import { Amount, EmptyState, ErrorState, PageHeader } from "@/components/ds/domain"
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, CountUp, Skeleton } from "@/components/ds/primitives"
import { Modal } from "@/components/ds/dialog"
import { dateTime, money, money0, relative } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LoadingRows } from "./ClaimsPage"

export default function PayoutsPage() {
  const eligible = useEligible()
  const batches = useBatches()
  const rows = useMemo(() => eligible.data?.content ?? [], [eligible.data])
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const [key, setKey] = useState(newIdempotencyKey)
  const invalidate = useInvalidateClaims()
  const selRows = rows.filter((r) => sel.has(r.id))
  const selTotal = selRows.reduce((s, r) => s + r.totalAmount, 0)
  const all = rows.length > 0 && rows.every((r) => sel.has(r.id))
  const waiting = (batches.data?.content ?? []).filter((b) => b.status === "PENDING_SEND")

  const create = useMutation({
    mutationFn: () => Api.createPayoutBatch([...sel], key),
    onSuccess: (b) => {
      setConfirm(false)
      setSel(new Set())
      setKey(newIdempotencyKey())
      invalidate()
      if (b.status === "SENT") toast.success(`${b.batchRef} sent to bank`, { description: `${b.claimCount} claims paid · ref ${b.bankReference}` })
      else toast(`${b.batchRef} created — waiting for bank`, { description: "The bank didn't answer yet. We retry every 30 seconds; no action needed." })
    },
    onError: (e) => toastError(e, "Couldn't create the batch"),
  })

  return (
    <>
      <PageHeader title="Payouts" sub="Bundle approved claims into a bank file. Claims are marked paid only when the bank accepts it." actions={<HeaderActions />} />

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line px-4 py-5 sm:px-6 md:grid-cols-4">
        <Stat2 i={0} label="Ready to pay" value={<CountUp value={rows.length} />} sub="Approved, no open sample audit" />
        <Stat2 i={1} label="Ready value" value={<span className="num"><span className="mr-0.5 text-[16px] font-normal text-ink-3">₹</span><CountUp value={rows.reduce((s, r) => s + r.totalAmount, 0)} format={money0} /></span>} />
        <Stat2 i={2} label="Waiting for bank" value={<span className={cn(waiting.length && "text-info")}><CountUp value={waiting.length} /></span>} sub={waiting.length ? "Auto-retry every 30 s" : "Nothing stuck"} />
        <Stat2 i={3} label="Batches sent" value={<CountUp value={(batches.data?.content ?? []).filter((b) => b.status === "SENT").length} />} />
      </div>

      <div className="grid gap-4 px-4 pt-5 pb-28 sm:px-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="stagger self-start overflow-hidden" style={{ "--i": 1 } as React.CSSProperties}>
          <CardHeader title="Eligible claims" sub={sel.size ? `${sel.size} selected · ₹${money(selTotal)}` : "Select claims to include in a batch"} action={
            <Button variant="primary" size="sm" disabled={!sel.size} onClick={() => setConfirm(true)} data-testid="create-batch">
              <Layers /> Create batch{sel.size ? ` (${sel.size})` : ""}
            </Button>
          } />
          {eligible.error ? (
            <ErrorState error={eligible.error} onRetry={eligible.refetch} />
          ) : eligible.isLoading ? (
            <LoadingRows n={4} />
          ) : !rows.length ? (
            <EmptyState icon={<CheckCircle2 />} title="Nothing to pay right now" body="Approved claims show up here, ready for the next batch." />
          ) : (
            <ul className="divide-y divide-line">
              <li className="flex items-center gap-3 bg-surface-2 px-4 py-2 text-[12px] text-ink-3">
                <Checkbox checked={all} indeterminate={sel.size > 0 && !all} onChange={(v) => setSel(v ? new Set(rows.map((r) => r.id)) : new Set())} label="Select all" data-testid="payout-select-all" />
                Select all
              </li>
              {rows.map((r, i) => (
                <li key={r.id} className={cn("stagger flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors", sel.has(r.id) ? "bg-cobalt-soft/50" : "hover:bg-surface-2")} style={{ "--i": Math.min(i, 10) } as React.CSSProperties}
                  onClick={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })}
                >
                  <Checkbox checked={sel.has(r.id)} onChange={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n })} label={`Select ${r.claimNumber}`} data-testid={`payout-select-${r.id}`} />
                  <Avatar name={r.employeeName} size={28} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/claims/${r.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-[13.5px] font-medium hover:underline">{r.title}</Link>
                    <p className="text-[11.5px] text-ink-3"><span className="font-mono">{r.claimNumber}</span> · {r.employeeName} · {r.departmentName}</p>
                  </div>
                  <Amount value={r.totalAmount} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="stagger self-start overflow-hidden" style={{ "--i": 2 } as React.CSSProperties}>
          <CardHeader title="Batches" sub="Newest first" />
          {batches.error ? (
            <ErrorState error={batches.error} onRetry={batches.refetch} />
          ) : batches.isLoading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-20 w-full rounded-[12px]" />)}</div>
          ) : !batches.data?.content.length ? (
            <EmptyState icon={<Landmark />} title="No batches yet" body="Create one from the eligible claims." />
          ) : (
            <ul className="flex flex-col gap-2.5 p-3">
              {batches.data.content.map((b, i) => <BatchItem key={b.id} b={b} i={i} />)}
            </ul>
          )}
        </Card>
      </div>

      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Create payout batch"
        description="Claims move to In payout and a bank CSV is generated. They become Paid when the bank accepts the file."
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()} data-testid="confirm-batch">
              <Banknote /> Pay ₹{money0(selTotal)}
            </Button>
          </>
        }
      >
        <div className="flex items-center justify-between rounded-[12px] bg-surface-2 px-4 py-3">
          <div>
            <p className="text-[12px] text-ink-3">{selRows.length} claims</p>
            <Amount value={selTotal} size="lg" />
          </div>
          <div className="flex -space-x-2">{selRows.slice(0, 5).map((r) => <Avatar key={r.id} name={r.employeeName} size={28} className="ring-2 ring-surface-2" />)}</div>
        </div>
      </Modal>
    </>
  )
}

function Stat2({ label, value, sub, i }: { label: string; value: React.ReactNode; sub?: string; i: number }) {
  return (
    <div className="stagger" style={{ "--i": i } as React.CSSProperties}>
      <p className="text-[12px] text-ink-3">{label}</p>
      <div className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.02em]">{value}</div>
      {sub && <p className="mt-1 text-[12px] text-ink-3">{sub}</p>}
    </div>
  )
}

function BatchItem({ b, i }: { b: PayoutBatch; i: number }) {
  const invalidate = useInvalidateClaims()
  const retry = useMutation({
    mutationFn: () => Api.retryPayoutBatch(b.id),
    onSuccess: (r) => {
      invalidate()
      if (r.status === "SENT") toast.success(`${r.batchRef} accepted by bank`, { description: `Ref ${r.bankReference}` })
      else toast.warning("Bank still unavailable", { description: r.lastError ?? "We'll keep retrying." })
    },
    onError: (e) => toastError(e),
  })
  const [downloading, setDownloading] = useState(false)
  async function download() {
    setDownloading(true)
    try {
      const res = await Api.downloadPayoutFile(b.id)
      const blob = await res.blob()
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = b.fileName
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      toastError(e, "Download failed")
    } finally {
      setDownloading(false)
    }
  }
  const pending = b.status === "PENDING_SEND"
  return (
    <li className={cn("stagger rounded-[12px] border p-3.5 transition-colors duration-500", pending ? "border-info/25 bg-info-soft/40" : "border-line bg-surface")} style={{ "--i": i } as React.CSSProperties} data-testid={`batch-${b.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[12.5px] font-medium">{b.batchRef}</p>
          <p className="mt-0.5 text-[12px] text-ink-3">{b.claimCount} claim{b.claimCount === 1 ? "" : "s"} · {relative(b.createdAt)}</p>
        </div>
        {pending ? <Badge tone="info" dot pulse>Waiting for bank</Badge> : <Badge tone="positive" dot>Sent</Badge>}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <Amount value={b.totalAmount} size="lg" />
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={download} loading={downloading} aria-label="Download CSV" data-testid={`download-${b.id}`}>
            {!downloading && <Download />} CSV
          </Button>
          {pending && (
            <Button size="sm" onClick={() => retry.mutate()} loading={retry.isPending} data-testid={`retry-${b.id}`}>
              {!retry.isPending && <RefreshCcw />} Retry now
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2.5 border-t border-line/70 pt-2.5 text-[11.5px] text-ink-3">
        {pending ? (
          <>Attempt {b.attempts} · {b.lastError ?? "Queued"} · auto-retry every 30 s</>
        ) : (
          <>Bank ref <span className="font-mono text-ink-2">{b.bankReference}</span> · {dateTime(b.sentAt)} · {b.attempts} attempt{b.attempts > 1 ? "s" : ""}</>
        )}
      </p>
    </li>
  )
}
