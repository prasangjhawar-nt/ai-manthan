import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Check, CornerUpLeft, X, Pencil, Receipt, MessageSquare, Send, FileX2, Maximize2, ShieldCheck, ShieldX, Clock3, Lock } from "lucide-react"
import type { AuditEvent, Claim, ClaimLine, Comment } from "@/api/types"
import { Api } from "@/api/endpoints"
import { useAuditTrail, useClaim, useComments, useDecision, useInvalidateClaims, toastError } from "@/api/hooks"
import { useAuth } from "@/lib/auth"
import { Avatar, Button, Card, CardHeader, Kbd, Skeleton, Textarea } from "@/components/ds/primitives"
import { Amount, CategoryIcon, ErrorState, FlagChip, OutcomeChip, StatusBadge, EmptyState } from "@/components/ds/domain"
import { Modal } from "@/components/ds/dialog"
import { CATEGORY_LABEL, LEVEL_FOR_ROLE, LEVEL_LABEL, ROLE_LABEL, STATUS_LABEL, date, dateLong, dateTime, money, relative } from "@/lib/format"
import { cn } from "@/lib/utils"

export default function ClaimDetailPage({ approverView = false }: { approverView?: boolean }) {
  const id = Number(useParams().id)
  const { data: claim, isLoading, error, refetch } = useClaim(id)

  if (isLoading) return <DetailSkeleton />
  if (error || !claim) return <ErrorState error={error} onRetry={refetch} className="py-24" />
  return <Detail claim={claim} approverView={approverView} />
}

function Detail({ claim, approverView }: { claim: Claim; approverView: boolean }) {
  const { user } = useAuth()
  const nav = useNavigate()
  const own = claim.employeeId === user?.id
  const canEdit = own && ["DRAFT", "NEEDS_CLARIFICATION"].includes(claim.status)
  const canAct = !own && claim.status.startsWith("PENDING_") && !!user && LEVEL_FOR_ROLE[user.role] === claim.currentLevel
  const canSample = user?.role === "AUDITOR" && claim.sampleAudit === "OPEN"
  const receipts = claim.lines.filter((l) => l.receiptId)
  const [activeReceipt, setActiveReceipt] = useState<number | null>(receipts[0]?.receiptId ?? null)
  const showViewer = approverView || canAct

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="animate-fade border-b border-line px-4 pt-4 pb-4 sm:px-6 sm:pt-5">
        <Link to={approverView ? "/approvals" : "/claims"} className="inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink" data-testid="back">
          <ArrowLeft className="size-3.5" /> {approverView ? "Approval queue" : "My claims"}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{claim.title}</h1>
              <StatusBadge status={claim.status} />
              {claim.sampleAudit === "OPEN" && <span className="rounded-full border border-info/25 bg-info-soft px-2 py-0.5 text-[11.5px] font-medium text-info">Sample audit</span>}
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
              <span className="font-mono text-[12px] text-ink-2">{claim.claimNumber}</span>
              <span className="text-ink-4">·</span>
              {!own && (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar name={claim.employeeName} size={18} /> {claim.employeeName}
                    {claim.departmentName && <span className="text-ink-4">({claim.departmentName})</span>}
                  </span>
                  <span className="text-ink-4">·</span>
                </>
              )}
              {claim.submittedAt ? `Submitted ${dateTime(claim.submittedAt)}` : `Created ${relative(claim.createdAt)}`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[12px] text-ink-3">Total</p>
              <Amount value={claim.totalAmount} size="xl" />
            </div>
            {canEdit && (
              <Button variant="primary" onClick={() => nav(`/claims/${claim.id}/edit`)} data-testid="edit-claim">
                <Pencil /> {claim.status === "DRAFT" ? "Continue editing" : "Update & resubmit"}
              </Button>
            )}
          </div>
        </div>
        <ChainTracker claim={claim} />
      </div>

      {claim.status === "NEEDS_CLARIFICATION" && own && <ClarificationBanner claim={claim} />}
      {claim.status === "REJECTED" && <RejectionBanner claim={claim} />}

      <div className={cn("grid flex-1 gap-5 px-4 pt-5 sm:px-6", canAct || canSample ? "pb-36" : "pb-10", showViewer ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_340px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        {showViewer && (
          <ReceiptViewer receipts={receipts} active={activeReceipt} onSelect={setActiveReceipt} claim={claim} className="lg:sticky lg:top-5 lg:self-start" />
        )}
        <Card className="stagger self-start overflow-hidden" style={{ "--i": 1 } as React.CSSProperties}>
          <CardHeader title={`Lines · ${claim.lines.length}`} action={<span className="text-[12px] text-ink-3">{claim.lines.filter((l) => l.flags.length).length} flagged</span>} />
          <ul className="divide-y divide-line">
            {claim.lines.map((l, i) => (
              <LineRow key={l.id} line={l} i={i} active={!!l.receiptId && l.receiptId === activeReceipt && showViewer} onReceipt={l.receiptId ? () => setActiveReceipt(l.receiptId!) : undefined} viewerMode={showViewer} />
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-line bg-surface-2 px-4 py-3">
            <span className="text-[13px] text-ink-2">Total</span>
            <Amount value={claim.totalAmount} size="lg" />
          </div>
        </Card>
        <Activity claim={claim} className={cn(showViewer && "lg:col-span-2 xl:col-span-1")} />
      </div>

      {canAct && <DecisionBar claim={claim} />}
      {canSample && !canAct && <SampleAuditBar claim={claim} />}
    </div>
  )
}

/* ---------------------------------------------------------------- Chain tracker */
function ChainTracker({ claim }: { claim: Claim }) {
  type S = "done" | "current" | "todo" | "failed" | "skipped"
  const steps: { key: string; label: string; state: S; meta?: string }[] = []
  const s = claim.status
  const submitted = s !== "DRAFT"
  steps.push({ key: "sub", label: "Submitted", state: submitted ? "done" : "current", meta: claim.submittedAt ? date(claim.submittedAt) : "Draft" })
  const levels: ("MANAGER" | "AUDITOR" | "HEAD")[] = ["MANAGER"]
  if (claim.totalAmount > 25000) levels.push("AUDITOR")
  if (claim.totalAmount > 100000) levels.push("HEAD")
  const lastStep = (lvl: string) => [...claim.approvalSteps].reverse().find((a) => a.level === lvl)
  const autoApproved = submitted && claim.approvalSteps.length === 0 && ["APPROVED", "IN_PAYOUT", "PAID"].includes(s)
  const curIdx = claim.currentLevel ? levels.indexOf(claim.currentLevel) : -1
  for (const [idx, lvl] of levels.entries()) {
    const st = lastStep(lvl)
    let state: S = "todo"
    if (autoApproved) state = "skipped"
    else if (claim.currentLevel === lvl) state = "current"
    else if (curIdx > idx) state = "done"
    else if (st?.decision === "APPROVED") state = "done"
    else if (st?.decision === "REJECTED") state = "failed"
    else if (st?.decision === "SENT_BACK" && s === "NEEDS_CLARIFICATION") state = "failed"
    else if (["APPROVED", "IN_PAYOUT", "PAID"].includes(s)) state = "done"
    steps.push({ key: lvl, label: LEVEL_LABEL[lvl], state, meta: state === "skipped" ? "Auto" : st ? `${st.actedByName?.split(" ")[0]} · ${date(st.decidedAt)}` : state === "current" ? "Waiting" : undefined })
  }
  const approved = ["APPROVED", "IN_PAYOUT", "PAID"].includes(s)
  steps.push({ key: "ok", label: s === "REJECTED" ? "Rejected" : "Approved", state: s === "REJECTED" ? "failed" : approved ? "done" : "todo", meta: claim.finalDecisionAt ? date(claim.finalDecisionAt) : undefined })
  steps.push({ key: "paid", label: "Paid", state: s === "PAID" ? "done" : s === "IN_PAYOUT" ? "current" : "todo", meta: s === "PAID" ? date(claim.paidAt) : s === "IN_PAYOUT" ? "Waiting for bank" : undefined })

  return (
    <ol className="no-scrollbar mt-5 flex items-start overflow-x-auto" aria-label="Approval progress">
      {steps.map((st, i) => (
        <li key={st.key} className="stagger flex min-w-[96px] flex-1 flex-col" style={{ "--i": i } as React.CSSProperties}>
          <div className="flex items-center">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] transition-colors",
                st.state === "done" && "border-obsidian bg-obsidian text-white",
                st.state === "current" && "animate-pulse-dot border-warning bg-warning-soft text-warning",
                st.state === "failed" && "border-danger bg-danger text-white",
                st.state === "todo" && "border-line-strong bg-surface text-ink-4",
                st.state === "skipped" && "border-dashed border-line-strong bg-surface-2 text-ink-4",
              )}
            >
              {st.state === "done" ? <Check className="size-3.5" strokeWidth={2.5} /> : st.state === "failed" ? <X className="size-3.5" strokeWidth={2.5} /> : st.state === "current" ? <Clock3 className="size-3.5" /> : i + 1}
            </span>
            {i < steps.length - 1 && (
              <span className="mx-1.5 h-px flex-1 overflow-hidden bg-line-strong">
                <span className={cn("block h-full origin-left bg-obsidian transition-transform duration-700 ease-out-quint", st.state === "done" || st.state === "skipped" ? "scale-x-100" : "scale-x-0")} style={{ transitionDelay: `${i * 90}ms` }} />
              </span>
            )}
          </div>
          <p className={cn("mt-2 text-[12.5px] font-medium", st.state === "todo" || st.state === "skipped" ? "text-ink-3" : "text-ink")}>{st.label}</p>
          {st.meta && <p className="text-[11.5px] text-ink-3">{st.meta}</p>}
        </li>
      ))}
    </ol>
  )
}

function ClarificationBanner({ claim }: { claim: Claim }) {
  const last = [...claim.approvalSteps].reverse().find((a) => a.decision === "SENT_BACK")
  return (
    <div className="mx-4 mt-5 flex animate-rise flex-col gap-3 rounded-card border border-violet/20 bg-violet-soft px-4 py-3.5 sm:mx-6 sm:flex-row sm:items-center">
      <MessageSquare className="size-5 shrink-0 text-violet" />
      <div className="flex-1 text-[13px]">
        <p className="font-medium text-violet">{last?.actedByName ?? "Your approver"} sent this back</p>
        {last?.comment && <p className="mt-0.5 text-ink-2">“{last.comment}”</p>}
      </div>
      <Link to={`/claims/${claim.id}/edit`} className="shrink-0">
        <Button variant="primary" size="sm">Fix and resubmit</Button>
      </Link>
    </div>
  )
}

function RejectionBanner({ claim }: { claim: Claim }) {
  const last = [...claim.approvalSteps].reverse().find((a) => a.decision === "REJECTED")
  const auto = claim.lines.filter((l) => l.outcome === "AUTO_REJECT")
  return (
    <div className="mx-4 mt-5 flex animate-rise gap-3 rounded-card border border-danger/20 bg-danger-soft px-4 py-3.5 text-[13px] sm:mx-6">
      <FileX2 className="size-5 shrink-0 text-danger" />
      <div>
        <p className="font-medium text-danger">{last ? `Rejected by ${last.actedByName}` : auto.length ? "Rejected by policy" : claim.sampleAudit === "FAILED" ? "Failed sample audit" : "Rejected"}</p>
        <p className="mt-0.5 text-ink-2">{last?.comment ?? (auto.length ? auto.map((l) => `Line ${l.lineNo}: ${l.reason}`).join(" · ") : "")}</p>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Lines */
function LineRow({ line, i, active, onReceipt, viewerMode }: { line: ClaimLine; i: number; active: boolean; onReceipt?: () => void; viewerMode: boolean }) {
  const perNight = line.category === "HOTEL" && line.nights ? line.amount / line.nights : null
  return (
    <li className={cn("stagger relative px-4 py-3.5 transition-colors duration-200", active && "bg-cobalt-soft/60", line.flags.length > 0 && "before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r before:bg-warning/70", line.outcome === "AUTO_REJECT" && "before:bg-danger")} style={{ "--i": i + 2 } as React.CSSProperties} data-testid={`line-row-${line.lineNo}`}>
      <div className="flex items-start gap-3">
        <CategoryIcon category={line.category} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{line.vendor}</p>
              <p className="text-[12px] text-ink-3">
                {CATEGORY_LABEL[line.category]} · {dateLong(line.expenseDate)}
                {line.city && ` · ${line.city}`}
                {line.nights && ` · ${line.nights} night${line.nights > 1 ? "s" : ""}`}
              </p>
            </div>
            <div className="text-right">
              <Amount value={line.amount} />
              {perNight && <p className="num text-[11.5px] text-ink-3">₹{money(perNight)}/night</p>}
            </div>
          </div>
          {line.description && <p className="mt-1 text-[12.5px] text-ink-2">{line.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <OutcomeChip outcome={line.outcome} />
            {line.flags.map((f) => (
              <FlagChip key={f} flag={f} />
            ))}
            {onReceipt ? (
              viewerMode ? (
                <button onClick={onReceipt} className={cn("ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] transition-colors", active ? "text-cobalt" : "text-ink-3 hover:bg-surface-3 hover:text-ink")} data-testid={`view-receipt-${line.lineNo}`}>
                  <Receipt className="size-3.5" /> Receipt
                </button>
              ) : (
                <ReceiptLink id={line.receiptId!} />
              )
            ) : (
              <span className="ml-auto text-[12px] text-ink-4">No receipt</span>
            )}
          </div>
          {line.reason && <p className="mt-1.5 text-[12.5px] text-ink-2">{line.reason}</p>}
        </div>
      </div>
    </li>
  )
}

function useReceiptUrl(id: number | null) {
  return useQuery({
    queryKey: ["receipt", id],
    enabled: !!id,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await Api.getReceiptContent(id!)
      const blob = await res.blob()
      return { url: URL.createObjectURL(blob), type: blob.type }
    },
  })
}

function ReceiptLink({ id }: { id: number }) {
  const [open, setOpen] = useState(false)
  const r = useReceiptUrl(open ? id : null)
  return (
    <>
      <button onClick={() => setOpen(true)} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink" data-testid={`receipt-${id}`}>
        <Receipt className="size-3.5" /> Receipt
      </button>
      <Modal open={open} onOpenChange={setOpen} title={`Receipt #${id}`} className="sm:max-w-[560px]">
        <div className="pb-4">{r.isLoading ? <Skeleton className="h-[420px] w-full" /> : r.data ? <ReceiptMedia url={r.data.url} type={r.data.type} /> : <ErrorState error={r.error} />}</div>
      </Modal>
    </>
  )
}

function ReceiptMedia({ url, type }: { url: string; type: string }) {
  if (type === "application/pdf") return <iframe src={url} title="Receipt" className="h-[60vh] w-full rounded-[10px] border border-line" />
  return <img src={url} alt="Receipt" className="mx-auto max-h-[64vh] animate-fade rounded-[10px] border border-line object-contain shadow-sm" />
}

function ReceiptViewer({ receipts, active, onSelect, claim, className }: { receipts: ClaimLine[]; active: number | null; onSelect: (id: number) => void; claim: Claim; className?: string }) {
  const r = useReceiptUrl(active)
  const line = receipts.find((l) => l.receiptId === active)
  return (
    <Card className={cn("stagger overflow-hidden", className)} style={{ "--i": 0 } as React.CSSProperties}>
      <CardHeader
        title="Receipts"
        sub={line ? `${line.vendor} · ₹${money(line.amount)}` : `${receipts.length} attached`}
        action={r.data && <a href={r.data.url} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label="Open full size"><Maximize2 className="size-4" /></a>}
      />
      {receipts.length > 1 && (
        <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
          {receipts.map((l) => (
            <button key={l.id} onClick={() => onSelect(l.receiptId!)} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] transition-colors", l.receiptId === active ? "bg-obsidian text-white" : "text-ink-2 hover:bg-surface-3")}>
              <span className="font-mono">L{l.lineNo}</span> {CATEGORY_LABEL[l.category]}
              {l.flags.length > 0 && <span className={cn("size-1.5 rounded-full", l.receiptId === active ? "bg-white" : "bg-warning")} />}
            </button>
          ))}
        </div>
      )}
      <div className="grid min-h-[360px] place-items-center bg-surface-2 p-4">
        {!receipts.length ? (
          <EmptyState icon={<Receipt />} title="No receipts" body={`${claim.employeeName} didn't attach any receipt.`} />
        ) : r.isLoading ? (
          <Skeleton className="h-[420px] w-[300px]" />
        ) : r.data ? (
          <ReceiptMedia key={r.data.url} url={r.data.url} type={r.data.type} />
        ) : (
          <ErrorState error={r.error} />
        )}
      </div>
    </Card>
  )
}

/* ---------------------------------------------------------------- Activity (audit + comments) */
const ACTION_TEXT: Partial<Record<AuditEvent["action"], string>> = {
  CLAIM_CREATED: "created the claim",
  CLAIM_UPDATED: "edited the claim",
  CLAIM_SUBMITTED: "submitted for approval",
  POLICY_EVALUATED: "ran policy checks",
  CLAIM_APPROVED: "approved",
  CLAIM_SENT_BACK: "sent it back",
  CLAIM_REJECTED: "rejected",
  SAMPLE_AUDIT_CLEARED: "cleared the sample audit",
  SAMPLE_AUDIT_FAILED: "failed the sample audit",
  RECEIPT_UPLOADED: "uploaded a receipt",
  PAYOUT_BATCH_CREATED: "added it to a payout batch",
  PAYOUT_SEND_FAILED: "payout attempt failed",
  PAYOUT_SENT: "sent payout to bank",
  CLAIM_PAID: "marked paid by the bank",
}

function Activity({ claim, className }: { claim: Claim; className?: string }) {
  const audit = useAuditTrail(claim.id)
  const comments = useComments(claim.id)
  const items = useMemo(() => {
    const a = (audit.data ?? []).filter((e) => e.action !== "COMMENT_ADDED").map((e) => ({ kind: "audit" as const, at: e.createdAt, e }))
    const c = (comments.data ?? []).map((m) => ({ kind: "comment" as const, at: m.createdAt, m }))
    return [...a, ...c].sort((x, y) => y.at.localeCompare(x.at))
  }, [audit.data, comments.data])

  return (
    <Card className="stagger self-start overflow-hidden" style={{ "--i": 2 } as React.CSSProperties}>
      <CardHeader title="Activity" action={<span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3"><Lock className="size-3" /> Append-only</span>} />
      <CommentBox claimId={claim.id} />
      <div className={cn("scroll-thin max-h-[560px] overflow-y-auto px-4 pb-4", className)}>
        {audit.isLoading || comments.isLoading ? (
          <div className="space-y-4 pt-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : audit.error ? (
          <ErrorState error={audit.error} onRetry={audit.refetch} />
        ) : (
          <ol className="relative pt-3">
            <span className="absolute top-5 bottom-3 left-[13px] w-px bg-line" aria-hidden />
            {items.map((it, i) => (
              <li key={`${it.kind}-${it.kind === "audit" ? it.e.id : it.m.id}`} className="stagger relative flex gap-3 py-2.5" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                {it.kind === "audit" ? <AuditItem e={it.e} /> : <CommentItem m={it.m} />}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  )
}

function AuditItem({ e }: { e: AuditEvent }) {
  const tone =
    e.action === "CLAIM_APPROVED" || e.action === "CLAIM_PAID" || e.action === "SAMPLE_AUDIT_CLEARED"
      ? "bg-positive text-white"
      : e.action === "CLAIM_REJECTED" || e.action === "SAMPLE_AUDIT_FAILED"
        ? "bg-danger text-white"
        : e.action === "CLAIM_SENT_BACK"
          ? "bg-violet text-white"
          : "bg-surface-3 text-ink-3"
  return (
    <>
      <span className={cn("relative z-10 mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-full ring-4 ring-surface", tone)}>
        {e.action === "CLAIM_APPROVED" || e.action === "CLAIM_PAID" ? <Check className="size-3.5" strokeWidth={2.5} /> : e.action === "CLAIM_REJECTED" ? <X className="size-3.5" /> : e.action === "CLAIM_SENT_BACK" ? <CornerUpLeft className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="text-ink-2">
          <span className="font-medium text-ink">{e.actorName ?? `User ${e.actorId}`}</span> {ACTION_TEXT[e.action] ?? e.action.toLowerCase().replace(/_/g, " ")}
          {e.onBehalfOfName && <span className="text-ink-3"> on behalf of {e.onBehalfOfName}</span>}
        </p>
        {e.toStatus && e.fromStatus !== e.toStatus && (
          <p className="mt-0.5 text-[12px] text-ink-3">
            {e.fromStatus ? `${STATUS_LABEL[e.fromStatus]} → ` : ""}
            <span className="text-ink-2">{STATUS_LABEL[e.toStatus]}</span>
          </p>
        )}
        {typeof e.details?.comment === "string" && e.details.comment && <p className="mt-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink-2">{e.details.comment}</p>}
        <p className="mt-0.5 text-[11.5px] text-ink-4" title={e.correlationId ?? undefined}>{dateTime(e.createdAt)}</p>
      </div>
    </>
  )
}

function CommentItem({ m }: { m: Comment }) {
  return (
    <>
      <Avatar name={m.authorName} size={26} className="relative z-10 mt-0.5 ring-4 ring-surface" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px]">
          <span className="font-medium">{m.authorName}</span> <span className="text-[12px] text-ink-3">{ROLE_LABEL[m.authorRole]}</span>
        </p>
        <p className="mt-1 rounded-[10px] rounded-tl-sm border border-line bg-surface px-3 py-2 text-[13px] text-ink-2 shadow-xs">{m.body}</p>
        <p className="mt-1 text-[11.5px] text-ink-4">{relative(m.createdAt)}</p>
      </div>
    </>
  )
}

function CommentBox({ claimId }: { claimId: number }) {
  const [body, setBody] = useState("")
  const invalidate = useInvalidateClaims()
  const m = useMutation({
    mutationFn: () => Api.addComment(claimId, body.trim()),
    onSuccess: () => {
      setBody("")
      invalidate()
    },
    onError: (e) => toastError(e, "Couldn't post comment"),
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (body.trim()) m.mutate()
      }}
      className="flex items-end gap-2 border-b border-line p-3"
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" rows={1} maxLength={1000} className="min-h-10 py-2 text-[13px]" aria-label="Comment" data-testid="comment-input"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && body.trim()) m.mutate()
        }}
      />
      <Button type="submit" size="icon" variant="primary" disabled={!body.trim()} loading={m.isPending} aria-label="Post comment" data-testid="comment-submit">
        {!m.isPending && <Send />}
      </Button>
    </form>
  )
}

/* ---------------------------------------------------------------- Decision bar */
type Action = "approve" | "send-back" | "reject"
function DecisionBar({ claim }: { claim: Claim }) {
  const nav = useNavigate()
  const [dialog, setDialog] = useState<Action | null>(null)
  const [comment, setComment] = useState("")
  const decision = useDecision(claim.id)
  const flagged = claim.lines.filter((l) => l.flags.length).length

  const next = claim.currentLevel === "MANAGER" ? (claim.totalAmount > 25000 ? "Auditor" : null) : claim.currentLevel === "AUDITOR" ? (claim.totalAmount > 100000 ? "Finance head" : null) : null

  const run = (action: Action, c = comment) =>
    decision.mutate(
      { action, comment: c },
      {
        onSuccess: (res) => {
          setDialog(null)
          setComment("")
          toast.success(action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Sent back", { description: `${res.claimNumber} → ${STATUS_LABEL[res.status]}` })
          nav("/approvals")
        },
        onError: (e) => toastError(e, "Couldn't record the decision"),
      },
    )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "a") setDialog("approve")
      if (e.key === "s") setDialog("send-back")
      if (e.key === "r") setDialog("reject")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [dialog])

  const cfg = {
    approve: { title: "Approve claim", desc: next ? `It moves on to the ${next.toLowerCase()} for the next approval.` : "This is the final approval. It becomes eligible for payout.", label: "Approve", variant: "positive" as const, required: false, placeholder: "Optional note for the record" },
    "send-back": { title: "Send back for clarification", desc: `${claim.employeeName.split(" ")[0]} can edit and resubmit. The chain restarts at manager.`, label: "Send back", variant: "primary" as const, required: true, placeholder: "What do they need to fix or attach?" },
    reject: { title: "Reject claim", desc: "This is final. The employee will see your reason.", label: "Reject", variant: "danger" as const, required: true, placeholder: "Reason for rejection" },
  }
  const d = dialog ? cfg[dialog] : null

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 animate-rise border-t border-line bg-surface/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-md lg:sticky lg:mx-6 lg:mb-4 lg:rounded-[16px] lg:border lg:shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="hidden text-[13px] sm:block">
            <p className="font-medium">Your decision · {claim.currentLevel && LEVEL_LABEL[claim.currentLevel]} level</p>
            <p className="text-[12px] text-ink-3">
              {flagged ? `${flagged} flagged line${flagged > 1 ? "s" : ""} · ` : "No flags · "}
              {next ? `approving sends it to ${next}` : "approving is final"}
              {" · "}shortcuts <Kbd>A</Kbd> <Kbd>S</Kbd> <Kbd>R</Kbd>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <Button variant="danger-soft" size="lg" onClick={() => setDialog("reject")} data-testid="reject">
              <X /> Reject
            </Button>
            <Button size="lg" onClick={() => setDialog("send-back")} data-testid="send-back">
              <CornerUpLeft /> Send back
            </Button>
            <Button variant="positive" size="lg" onClick={() => setDialog("approve")} data-testid="approve">
              <Check /> Approve
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={d?.title}
        description={d?.desc}
        footer={
          d && (
            <>
              <Button onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant={d.variant} loading={decision.isPending} disabled={d.required && !comment.trim()} onClick={() => run(dialog!)} data-testid="confirm-decision">
                {d.label}
              </Button>
            </>
          )
        }
      >
        {d && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-[10px] bg-surface-2 px-3 py-2.5 text-[13px]">
              <span className="text-ink-2">{claim.claimNumber}</span>
              <Amount value={claim.totalAmount} />
            </div>
            <Textarea
              autoFocus
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={d.placeholder}
              maxLength={1000}
              aria-label="Comment"
              data-testid="decision-comment"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && (!d.required || comment.trim())) run(dialog!)
              }}
            />
            <p className="text-right text-[11.5px] text-ink-4">{d.required ? "Required · " : ""}Ctrl + Enter to confirm</p>
          </div>
        )}
      </Modal>
    </>
  )
}

function SampleAuditBar({ claim }: { claim: Claim }) {
  const invalidate = useInvalidateClaims()
  const [failing, setFailing] = useState(false)
  const [reason, setReason] = useState("")
  const m = useMutation({
    mutationFn: (v: { result: "CLEARED" | "FAILED"; reason?: string }) => Api.resolveSampleAudit(claim.id, v.result, v.reason),
    onSuccess: (res) => {
      setFailing(false)
      invalidate()
      toast.success(res.sampleAudit === "CLEARED" ? "Sample audit cleared" : "Sample audit failed — claim rejected")
    },
    onError: (e) => toastError(e),
  })
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 animate-rise border-t border-line bg-surface/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-md lg:sticky lg:mx-6 lg:mb-4 lg:rounded-[16px] lg:border lg:shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[13px]">
            <p className="font-medium">Random sample audit</p>
            <p className="text-[12px] text-ink-3">This auto-approved claim was picked for a check. Payout waits until you clear it.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="danger-soft" size="lg" onClick={() => setFailing(true)} data-testid="sample-fail">
              <ShieldX /> Fail
            </Button>
            <Button variant="positive" size="lg" loading={m.isPending && !failing} onClick={() => m.mutate({ result: "CLEARED" })} data-testid="sample-clear">
              <ShieldCheck /> Clear
            </Button>
          </div>
        </div>
      </div>
      <Modal
        open={failing}
        onOpenChange={setFailing}
        title="Fail sample audit"
        description="The claim will be rejected and removed from payout."
        footer={
          <>
            <Button onClick={() => setFailing(false)}>Cancel</Button>
            <Button variant="danger" disabled={!reason.trim()} loading={m.isPending} onClick={() => m.mutate({ result: "FAILED", reason })}>
              Fail audit
            </Button>
          </>
        }
      >
        <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What didn't match?" aria-label="Reason" />
      </Modal>
    </>
  )
}

function DetailSkeleton() {
  return (
    <div className="px-6 pt-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-7 w-72" />
      <Skeleton className="mt-2 h-4 w-48" />
      <div className="mt-6 flex gap-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 flex-1" />)}</div>
      <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Skeleton className="h-80 rounded-card" />
        <Skeleton className="h-80 rounded-card" />
      </div>
    </div>
  )
}

