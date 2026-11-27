import { useEffect, useMemo, useRef, useState } from "react"
import { Controller, useFieldArray, useForm, useWatch, type Control, type UseFormRegister, type FieldErrors, type UseFormSetValue } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useNavigate, useParams, Link } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, Camera, CheckCircle2, FileUp, Loader2, Paperclip, Plus, Trash2, AlertTriangle, Route, Send } from "lucide-react"
import type { Category, PolicyConfig } from "@/api/types"
import { CATEGORIES } from "@/api/types"
import { Api } from "@/api/endpoints"
import { ApiError, newIdempotencyKey } from "@/api/client"
import { useClaim, useInvalidateClaims, usePolicy, toastError } from "@/api/hooks"
import { Button, CountUp, Field, Input, Skeleton } from "@/components/ds/primitives"
import { CategoryGlyph, ErrorState, FlagChip, PageHeader } from "@/components/ds/domain"
import { CATEGORY_COLOR, CATEGORY_LABEL, STATUS_LABEL, money, money0 } from "@/lib/format"
import { cn } from "@/lib/utils"
import { claimSchema as schema, hotelLimit, localDaysAgo, localToday, predictRoute, previewLine, type ClaimFormValues as FormValues, type RouteInfo, type LinePreview } from "@/lib/claim-rules"
import { CityCombobox } from "@/components/ds/combobox"

const NO_PREVIEW: LinePreview = { flags: [], notes: [], reject: false }

const blankLine = (category: Category = "MEALS"): FormValues["lines"][number] => ({ category, expenseDate: localToday(), amount: undefined as unknown as number, vendor: "", city: "", nights: null, description: "", receiptId: null })

export default function ClaimFormPage() {
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const existing = useClaim(editId ?? NaN)
  const policy = usePolicy()
  if (editId && existing.isLoading) return <FormSkeleton />
  if (editId && existing.error) return <ErrorState error={existing.error} onRetry={existing.refetch} className="py-24" />
  const c = existing.data
  if (c && !["DRAFT", "NEEDS_CLARIFICATION"].includes(c.status))
    return (
      <ErrorState
        className="py-24"
        error={new ApiError({ title: "This claim can't be edited", status: 409, detail: `It's ${STATUS_LABEL[c.status].toLowerCase()}. Only drafts and claims sent back for clarification can be changed.` })}
      />
    )
  return <ClaimForm key={c?.id ?? "new"} claim={c} policy={policy.data} />
}

function ClaimForm({ claim, policy }: { claim?: import("@/api/types").Claim; policy?: PolicyConfig }) {
  const nav = useNavigate()
  const invalidate = useInvalidateClaims()
  const [claimId, setClaimId] = useState<number | null>(claim?.id ?? null)
  const [version, setVersion] = useState(claim?.version ?? 0)
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null)
  const lock = useRef(false) // synchronous double-click guard (state updates are async)
  const createKey = useRef(newIdempotencyKey())
  const submitKey = useRef(newIdempotencyKey())

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: claim
      ? { title: claim.title, lines: claim.lines.map((l) => ({ category: l.category, expenseDate: l.expenseDate, amount: l.amount, vendor: l.vendor, city: l.city ?? "", nights: l.nights ?? null, description: l.description ?? "", receiptId: l.receiptId ?? null })) }
      : { title: "", lines: [blankLine()] },
    mode: "onTouched",
  })
  const { control, register, handleSubmit, formState, setValue } = form
  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  const lines = useWatch({ control, name: "lines" })
  const total = (lines ?? []).reduce((s, l) => s + (Number.isFinite(l?.amount) ? l.amount : 0), 0)

  const mealsByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines ?? []) if (l?.category === "MEALS" && l.amount) m.set(l.expenseDate, (m.get(l.expenseDate) ?? 0) + l.amount)
    return m
  }, [lines])
  const previews = (lines ?? []).map((l) => previewLine(l, policy, mealsByDay.get(l?.expenseDate) ?? 0))
  const route = predictRoute(total, previews, policy)

  const toPayload = (v: FormValues) => ({
    title: v.title.trim(),
    lines: v.lines.map((l) => ({
      ...l,
      city: l.city?.trim() || null,
      nights: l.category === "HOTEL" ? l.nights ?? null : null,
      description: l.description?.trim() || null,
      receiptId: l.receiptId ?? null,
    })),
  })

  async function save(v: FormValues) {
    const body = toPayload(v)
    if (claimId) {
      const c = await Api.updateClaim(claimId, { version, ...body })
      setVersion(c.version)
      return c
    }
    const c = await Api.createClaim(body, createKey.current)
    setClaimId(c.id)
    setVersion(c.version)
    window.history.replaceState(null, "", `/claims/${c.id}/edit`)
    return c
  }

  const guarded = (fn: (e?: React.BaseSyntheticEvent) => Promise<void>) => async (e?: React.BaseSyntheticEvent) => {
    e?.preventDefault()
    if (lock.current) return
    lock.current = true
    try {
      await fn(e)
    } finally {
      lock.current = false
    }
  }

  const onDraft = handleSubmit(async (v) => {
    setBusy("draft")
    try {
      await save(v)
      await invalidate()
      toast.success("Draft saved", { description: "You can come back and finish it any time." })
    } catch (e) {
      applyServerErrors(e)
    } finally {
      setBusy(null)
    }
  }, scrollToError)

  const onSubmit = handleSubmit(async (v) => {
    if (busy) return
    setBusy("submit")
    try {
      const saved = await save(v)
      const res = await Api.submitClaim(saved.id, submitKey.current)
      await invalidate()
      const msg =
        res.status === "APPROVED" ? "Auto-approved — it'll be in the next payout." : res.status === "REJECTED" ? "Rejected by policy. See the reasons on each line." : `Sent for review · ${STATUS_LABEL[res.status]}`
      ;(res.status === "REJECTED" ? toast.error : toast.success)(`${res.claimNumber} submitted`, { description: msg })
      nav(`/claims/${res.id}`, { replace: true })
    } catch (e) {
      applyServerErrors(e)
      setBusy(null)
    }
  }, scrollToError)

  function applyServerErrors(e: unknown) {
    if (e instanceof ApiError && e.problem.errors?.length) {
      for (const fe of e.problem.errors) form.setError(fe.field.replace(/\[(\d+)\]/g, ".$1") as never, { message: fe.message })
    }
    if (e instanceof ApiError && e.status === 409) toast.error("This claim changed elsewhere", { description: "Reload the page to get the latest version." })
    else toastError(e, "Couldn't save the claim")
  }

  return (
    <form onSubmit={guarded(onSubmit)} noValidate className="flex min-h-full flex-col">
      <PageHeader
        title={claim ? (claim.status === "NEEDS_CLARIFICATION" ? "Update & resubmit" : "Edit draft") : "New claim"}
        sub={
          <Link to={claim ? `/claims/${claim.id}` : "/claims"} className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="size-3.5" /> {claim ? claim.claimNumber : "My claims"}
          </Link>
        }
      />

      {claim?.status === "NEEDS_CLARIFICATION" && claim.approvalSteps.at(-1)?.comment && (
        <div className="mx-4 mt-4 animate-rise rounded-card border border-violet/20 bg-violet-soft px-4 py-3 text-[13px] sm:mx-6">
          <p className="font-medium text-violet">{claim.approvalSteps.at(-1)?.actedByName} asked:</p>
          <p className="mt-0.5 text-ink-2">“{claim.approvalSteps.at(-1)?.comment}”</p>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-[1100px] flex-1 gap-6 px-4 pt-5 pb-40 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:pb-10">
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Claim title" htmlFor="title" error={formState.errors.title?.message}>
            <Input id="title" placeholder="e.g. Mumbai client visit" className="h-11 text-[15px]" aria-invalid={!!formState.errors.title} data-testid="claim-title" {...register("title")} />
          </Field>

          <div className="flex items-center justify-between pt-2">
            <h2 className="eyebrow">Expense lines</h2>
            <span className="text-[12px] text-ink-3">{fields.length} / 20</span>
          </div>

          {fields.map((f, i) => (
            <LineCard
              key={f.id}
              index={i}
              control={control}
              register={register}
              setValue={setValue}
              errors={formState.errors}
              preview={previews[i] ?? NO_PREVIEW}
              tier1={policy?.tier1Cities ?? []}
              limits={{ t1: hotelLimit(1, policy), other: hotelLimit(2, policy) }}
              onRemove={fields.length > 1 ? () => remove(i) : undefined}
            />
          ))}

          <button
            type="button"
            onClick={() => append(blankLine((lines?.at(-1)?.category as Category) ?? "MEALS"))}
            disabled={fields.length >= 20}
            className="flex h-12 items-center justify-center gap-2 rounded-card border border-dashed border-line-strong text-[13.5px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            data-testid="add-line"
          >
            <Plus className="size-4" /> Add another expense
          </button>
        </div>

        {/* Summary — sticky sidebar on desktop, bottom sheet bar on mobile */}
        <aside className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-md lg:sticky lg:top-5 lg:self-start lg:rounded-card lg:border lg:p-0 lg:backdrop-blur-none">
          <div className="lg:p-4">
            <div className="flex items-end justify-between gap-3 lg:block">
              <div>
                <p className="eyebrow hidden lg:block">Claim total</p>
                <p className="text-[12px] text-ink-3 lg:hidden">Total · {fields.length} line{fields.length > 1 ? "s" : ""}</p>
                <p className="num mt-0.5 text-[24px] leading-tight font-semibold tracking-[-0.025em] lg:mt-2 lg:text-[30px]" data-testid="running-total">
                  <span className="mr-1 text-[0.6em] font-normal text-ink-3">₹</span>
                  <CountUp value={total} format={(n) => money(n)} duration={400} />
                </p>
              </div>
              <RouteHint route={route} compact />
            </div>
            <div className="hidden lg:block">
              <RouteHint route={route} />
            </div>
          </div>
          <div className="mt-3 flex gap-2 lg:mt-0 lg:flex-col lg:border-t lg:border-line lg:p-4">
            <Button type="submit" variant="primary" size="lg" className="flex-1 lg:w-full lg:flex-none" loading={busy === "submit"} disabled={!!busy} data-testid="submit-claim">
              <Send /> Submit claim
            </Button>
            <Button size="lg" className="lg:w-full" onClick={guarded(onDraft)} loading={busy === "draft"} disabled={!!busy} data-testid="save-draft">
              Save draft
            </Button>
          </div>
        </aside>
      </div>
    </form>
  )
}

function scrollToError() {
  requestAnimationFrame(() => document.querySelector("[aria-invalid=true]")?.scrollIntoView({ behavior: "smooth", block: "center" }))
}

function RouteHint({ route, compact }: { route: RouteInfo; compact?: boolean }) {
  const color = { neutral: "text-ink-3", positive: "text-positive", warning: "text-warning", danger: "text-danger" }[route.tone]
  if (compact)
    return (
      <span className={cn("flex items-center gap-1 text-[12px] font-medium lg:hidden", color)}>
        <Route className="size-3.5" /> {route.label}
      </span>
    )
  return (
    <div className="mt-4 rounded-[10px] bg-surface-2 p-3">
      <p className={cn("flex items-center gap-1.5 text-[13px] font-medium", color)}>
        <Route className="size-4" /> {route.label}
      </p>
      {route.steps.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-ink-2">
          {route.steps.map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <span className="text-ink-4">→</span>}
              <span className="rounded-md border border-line bg-surface px-1.5 py-0.5">{s}</span>
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{route.detail}</p>
    </div>
  )
}

/* ----------------------------------------------------------- Line card */
function LineCard({
  index,
  control,
  register,
  setValue,
  errors,
  preview,
  tier1,
  limits,
  onRemove,
}: {
  index: number
  control: Control<FormValues>
  register: UseFormRegister<FormValues>
  setValue: UseFormSetValue<FormValues>
  errors: FieldErrors<FormValues>
  preview: LinePreview
  tier1: string[]
  limits: { t1?: number; other?: number }
  onRemove?: () => void
}) {
  const category = useWatch({ control, name: `lines.${index}.category` })
  const receiptId = useWatch({ control, name: `lines.${index}.receiptId` })
  const e = errors.lines?.[index]
  const p = `lines.${index}` as const

  return (
    <div className="animate-rise rounded-card border border-line bg-surface transition-shadow duration-200 focus-within:shadow-md" data-testid={`line-${index}`}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <span className="grid size-5 place-items-center rounded-md bg-surface-3 font-mono text-[11px] text-ink-2">{index + 1}</span>
          {CATEGORY_LABEL[category]}
        </span>
        {onRemove && (
          <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label={`Remove line ${index + 1}`} data-testid={`remove-line-${index}`}>
            <Trash2 />
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Category picker */}
        <div role="radiogroup" aria-label="Category" className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">
          {CATEGORIES.map((c) => {
            const on = c === category
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setValue(`${p}.category`, c, { shouldValidate: true, shouldDirty: true })}
                className={cn(
                  "flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border px-2 text-[12.5px] sm:text-[13px] transition-all duration-150 sm:justify-start sm:px-3",
                  on ? "border-transparent text-white shadow-sm" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2",
                )}
                style={on ? { background: CATEGORY_COLOR[c] } : undefined}
                data-testid={`line-${index}-cat-${c}`}
              >
                <CategoryGlyph category={c} className="size-4" />
                {CATEGORY_LABEL[c]}
              </button>
            )
          })}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Amount (₹)" htmlFor={`${p}.amount`} error={e?.amount?.message} className="col-span-1 sm:col-span-1">
            <Input id={`${p}.amount`} type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" className="num" aria-invalid={!!e?.amount} data-testid={`line-${index}-amount`} {...register(`${p}.amount`, { valueAsNumber: true })} />
          </Field>
          <Field label="Date" htmlFor={`${p}.expenseDate`} error={e?.expenseDate?.message}>
            <Input id={`${p}.expenseDate`} type="date" max={localToday()} min={localDaysAgo(90)} aria-invalid={!!e?.expenseDate} data-testid={`line-${index}-date`} {...register(`${p}.expenseDate`)} />
          </Field>
          <Field label="Vendor" htmlFor={`${p}.vendor`} error={e?.vendor?.message} className="col-span-2">
            <Input id={`${p}.vendor`} placeholder="Hotel, airline, restaurant…" aria-invalid={!!e?.vendor} data-testid={`line-${index}-vendor`} {...register(`${p}.vendor`)} />
          </Field>
          <Field label="City" htmlFor={`${p}.city`} error={e?.city?.message} optional={category !== "HOTEL"} className={category === "HOTEL" ? "col-span-1 sm:col-span-2" : "col-span-2"}>
            <Controller
              control={control}
              name={`${p}.city`}
              render={({ field }) => (
                <CityCombobox
                  id={`${p}.city`}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  cities={tier1}
                  invalid={!!e?.city}
                  placeholder="City"
                  tier1Hint={category === "HOTEL" && limits.t1 ? `₹${money0(limits.t1)}/night` : undefined}
                  otherHint={category === "HOTEL" && limits.other ? `₹${money0(limits.other)}/night` : undefined}
                  testId={`line-${index}-city`}
                />
              )}
            />
          </Field>
          {category === "HOTEL" && (
            <Field label="Nights" htmlFor={`${p}.nights`} error={e?.nights?.message} className="animate-fade">
              <Input id={`${p}.nights`} type="number" inputMode="numeric" min={1} max={30} placeholder="1" aria-invalid={!!e?.nights} data-testid={`line-${index}-nights`} {...register(`${p}.nights`, { setValueAs: (v) => (v === "" || v == null ? null : Number(v)) })} />
            </Field>
          )}
          <Field label="Note" htmlFor={`${p}.description`} optional className={category === "HOTEL" ? "col-span-1" : "col-span-2"}>
            <Input id={`${p}.description`} placeholder="Purpose" data-testid={`line-${index}-desc`} {...register(`${p}.description`)} />
          </Field>
        </div>

        <ReceiptPicker index={index} receiptId={receiptId ?? null} onUploaded={(rid) => setValue(`${p}.receiptId`, rid, { shouldDirty: true })} />

        {preview.notes.length > 0 && (
          <div className={cn("animate-fade rounded-[10px] px-3 py-2.5 text-[12.5px]", preview.reject ? "bg-danger-soft" : "bg-warning-soft/70")}>
            <div className="flex flex-wrap gap-1">{preview.flags.map((f) => <FlagChip key={f} flag={f} />)}</div>
            <ul className="mt-1.5 space-y-0.5 text-ink-2">
              {preview.notes.map((n) => (
                <li key={n} className="flex gap-1.5">
                  <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", preview.reject ? "text-danger" : "text-warning")} /> {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function ReceiptPicker({ index, receiptId, onUploaded }: { index: number; receiptId: number | null; onUploaded: (id: number | null) => void }) {
  const [state, setState] = useState<{ status: "idle" | "uploading" | "done" | "error"; name?: string; dup?: boolean; msg?: string }>(receiptId ? { status: "done", name: `Receipt #${receiptId}` } : { status: "idle" })
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)

  useEffect(() => {
    if (!receiptId && state.status === "done") setState({ status: "idle" })
  }, [receiptId, state.status])

  async function upload(file?: File) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return setState({ status: "error", msg: "That file is over 5 MB." })
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) return setState({ status: "error", msg: "Use a JPEG, PNG or PDF." })
    setState({ status: "uploading", name: file.name })
    try {
      const r = await Api.uploadReceipt(file)
      onUploaded(r.id)
      setState({ status: "done", name: r.fileName, dup: !!r.duplicateOfReceiptId })
    } catch (e) {
      setState({ status: "error", msg: e instanceof ApiError ? (e.problem.detail ?? e.message) : "Upload failed" })
    }
  }

  if (state.status === "done" || state.status === "uploading")
    return (
      <div className="flex animate-fade items-center gap-3 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5">
        <span className={cn("grid size-8 place-items-center rounded-lg", state.status === "done" ? "bg-positive-soft text-positive" : "bg-surface-3 text-ink-3")}>
          {state.status === "uploading" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{state.name}</p>
          <p className="text-[11.5px] text-ink-3">{state.status === "uploading" ? "Uploading and hashing…" : state.dup ? "Same file was uploaded before — it may be flagged as duplicate" : "Attached · SHA-256 stored"}</p>
        </div>
        {state.status === "done" && (
          <Button size="sm" variant="ghost" onClick={() => { onUploaded(null); setState({ status: "idle" }) }} data-testid={`line-${index}-receipt-remove`}>
            Replace
          </Button>
        )}
      </div>
    )

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]) }}
        className={cn("flex items-center gap-3 rounded-[10px] border border-dashed px-3 py-2.5 transition-colors duration-150", drag ? "border-cobalt bg-cobalt-soft" : "border-line-strong")}
      >
        <Paperclip className="size-4 shrink-0 text-ink-3" />
        <p className="flex-1 text-[12.5px] text-ink-3">
          <span className="hidden sm:inline">Drop a receipt here, or </span>attach JPEG, PNG or PDF · max 5 MB
        </p>
        <Button size="sm" variant="soft" onClick={() => camera.current?.click()} className="sm:hidden" aria-label="Take photo">
          <Camera />
        </Button>
        <Button size="sm" onClick={() => input.current?.click()} data-testid={`line-${index}-receipt`}>
          <FileUp /> Attach
        </Button>
        <input ref={input} type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
      {state.status === "error" && <p className="mt-1.5 animate-fade text-[12px] text-danger">{state.msg}</p>}
    </div>
  )
}

function FormSkeleton() {
  return (
    <div className="px-6 pt-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-8 h-11 w-full max-w-xl" />
      <Skeleton className="mt-6 h-56 w-full max-w-3xl rounded-card" />
    </div>
  )
}
