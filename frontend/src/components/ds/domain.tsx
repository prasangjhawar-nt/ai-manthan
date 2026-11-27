import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { BedDouble, Plane, Utensils, CarTaxiFront, TrainFront, Package, AlertTriangle, RefreshCcw, Copy, CalendarDays, Receipt, ShieldQuestion, Check, ArrowRight, X } from "lucide-react"
import type { Category, ClaimStatus, Flag, LineOutcome } from "@/api/types"
import { ApiError } from "@/api/client"
import { cn } from "@/lib/utils"
import { CATEGORY_COLOR, CATEGORY_LABEL, FLAG_LABEL, FLAG_TONE, OUTCOME_LABEL, OUTCOME_TONE, STATUS_LABEL, STATUS_TONE, money } from "@/lib/format"
import { Badge, Button, Chip } from "./primitives"
import { Tooltip } from "./tooltip"

/* ------------------------------------------------------------------ Status */
export function StatusBadge({ status, className }: { status: ClaimStatus; className?: string }) {
  const pending = status.startsWith("PENDING_") || status === "IN_PAYOUT"
  return (
    <Badge tone={STATUS_TONE[status]} dot pulse={pending} className={className}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}

const flagIcon: Record<Flag, ReactNode> = {
  OVER_LIMIT: <AlertTriangle />,
  MISSING_RECEIPT: <Receipt />,
  DUPLICATE: <Copy />,
  WEEKEND: <CalendarDays />,
  NO_POLICY: <ShieldQuestion />,
}
export function FlagChip({ flag }: { flag: Flag }) {
  return (
    <Chip tone={FLAG_TONE[flag]} icon={flagIcon[flag]}>
      {FLAG_LABEL[flag]}
    </Chip>
  )
}
export function FlagList({ flags, max = 3 }: { flags: Flag[]; max?: number }) {
  if (!flags.length) return <span className="text-[12px] text-ink-4">—</span>
  return (
    <div className="flex flex-wrap items-center gap-1">
      {flags.slice(0, max).map((f) => (
        <FlagChip key={f} flag={f} />
      ))}
      {flags.length > max && (
        <Tooltip
          content={
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-medium tracking-[0.04em] text-ink-3 uppercase">{flags.length - max} more flag{flags.length - max > 1 ? "s" : ""}</p>
              <div className="flex flex-wrap gap-1">
                {flags.slice(max).map((f) => (
                  <FlagChip key={f} flag={f} />
                ))}
              </div>
            </div>
          }
        >
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            aria-label={`${flags.length - max} more: ${flags.slice(max).map((f) => FLAG_LABEL[f]).join(", ")}`}
            className="inline-flex h-[22px] items-center rounded-chip bg-surface-3 px-1.5 text-[11.5px] font-medium text-ink-2 transition-colors hover:bg-ink hover:text-white focus-visible:bg-ink focus-visible:text-white"
            data-testid="flags-more"
          >
            +{flags.length - max}
          </button>
        </Tooltip>
      )}
    </div>
  )
}

const outcomeIcon: Record<LineOutcome, ReactNode> = { AUTO_APPROVE: <Check />, ROUTE: <ArrowRight />, AUTO_REJECT: <X /> }
export function OutcomeChip({ outcome }: { outcome: LineOutcome | null }) {
  if (!outcome) return <Chip>Not checked</Chip>
  return (
    <Chip tone={OUTCOME_TONE[outcome]} icon={outcomeIcon[outcome]}>
      {OUTCOME_LABEL[outcome]}
    </Chip>
  )
}

/* ------------------------------------------------------------------ Category */
const catIcon: Record<Category, typeof BedDouble> = { HOTEL: BedDouble, FLIGHT: Plane, MEALS: Utensils, LOCAL_CAB: CarTaxiFront, TRAIN: TrainFront, OTHER: Package }
export function CategoryIcon({ category, size = 32, className }: { category: Category; size?: number; className?: string }) {
  const Icon = catIcon[category]
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-[9px] text-white", className)}
      style={{ width: size, height: size, background: CATEGORY_COLOR[category] }}
      title={CATEGORY_LABEL[category]}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.9} />
    </span>
  )
}
export function CategoryGlyph({ category, className }: { category: Category; className?: string }) {
  const Icon = catIcon[category]
  return <Icon className={className} strokeWidth={1.8} />
}

/* ------------------------------------------------------------------ Amount */
/** ₹ 30,500.00 with muted currency + decimals — the money typography rule. */
export function Amount({ value, className, size = "md", muted }: { value: number | null | undefined; className?: string; size?: "sm" | "md" | "lg" | "xl"; muted?: boolean }) {
  const s = money(value)
  const [int, dec] = s.split(".")
  const sizes = { sm: "text-[13px]", md: "text-[14px]", lg: "text-[20px] tracking-[-0.01em]", xl: "text-[30px] tracking-[-0.025em] leading-none" }
  return (
    <span className={cn("num font-medium whitespace-nowrap", sizes[size], muted ? "text-ink-2" : "text-ink", className)}>
      <span className="mr-0.5 text-ink-3 font-normal">₹</span>
      {int}
      {dec && <span className="text-ink-4">.{dec}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ Segmented (animated pill) */
export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string; size?: "sm" | "md" }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth })
  }, [value, options.length])
  return (
    <div ref={wrap} role="tablist" className={cn("no-scrollbar relative inline-flex max-w-full overflow-x-auto rounded-[11px] border border-line bg-surface-2 p-[3px]", className)}>
      {pill && (
        <span
          aria-hidden
          className="absolute top-[3px] bottom-[3px] rounded-[8px] bg-obsidian shadow-sm transition-[left,width] duration-300 ease-out-quint"
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 inline-flex items-center gap-1.5 rounded-[8px] font-medium whitespace-nowrap transition-colors duration-200",
              size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3.5 text-[13px]",
              active ? "text-white" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={cn("num rounded-full px-1.5 text-[11px] leading-[18px] transition-colors", active ? "bg-white/15 text-white" : "bg-surface-3 text-ink-3")}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ States */
export function EmptyState({ icon, title, body, action, className }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex animate-fade flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-full border border-line bg-surface-2 text-ink-3 [&_svg]:size-5">{icon}</div>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {body && <p className="mt-1 max-w-sm text-[13px] text-ink-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const p = error instanceof ApiError ? error.problem : null
  return (
    <div role="alert" className={cn("flex animate-fade flex-col items-center px-6 py-12 text-center", className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="size-5" />
      </div>
      <p className="text-[14px] font-medium">{p?.status === 404 ? "Not found" : (p?.title ?? "Couldn't load this")}</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-3">{p?.detail ?? "Something went wrong on our side."}</p>
      {p?.correlationId && <p className="mt-2 font-mono text-[11px] text-ink-4">Ref {p.correlationId}</p>}
      {onRetry && p?.status !== 404 && (
        <Button size="sm" className="mt-4" onClick={onRetry} data-testid="retry">
          <RefreshCcw /> Try again
        </Button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Page header */
export function PageHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="animate-fade border-b border-line px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {sub && <p className="mt-1 text-[13px] text-ink-3">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ Stat */
export function Stat({ label, value, sub, className, style }: { label: string; value: ReactNode; sub?: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("stagger min-w-0", className)} style={style}>
      <p className="text-[12px] text-ink-3">{label}</p>
      <div className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.02em]">{value}</div>
      {sub && <p className="mt-1 text-[12px] text-ink-3">{sub}</p>}
    </div>
  )
}
