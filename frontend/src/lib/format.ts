import type { ApprovalLevel, Category, ClaimStatus, Flag, LineOutcome, Role } from "@/api/types"

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 })

/** 30,500.00 — Indian grouping, 2 decimals. */
export const money = (n: number | null | undefined) => (n == null ? "—" : inr.format(n))
/** 30,500 — no decimals for KPIs. */
export const money0 = (n: number | null | undefined) => (n == null ? "—" : inr0.format(n))
/** 1.8 Cr / 51.2 L / 30.5K — compact Indian units for charts. */
export function moneyCompact(n: number) {
  if (n >= 1e7) return `${(n / 1e7).toFixed(n >= 1e8 ? 0 : 2)} Cr`
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return inr0.format(n)
}

export function date(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!iso) return "—"
  const d = iso.length === 10 ? new Date(iso + "T00:00:00") : new Date(iso)
  return d.toLocaleDateString("en-IN", opts)
}
export const dateLong = (iso: string | null | undefined) => date(iso, { day: "numeric", month: "short", year: "numeric" })
export function dateTime(iso: string | null | undefined) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}
export function relative(iso: string | null | undefined) {
  if (!iso) return "—"
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return date(iso)
}
export function hours(h: number | null | undefined) {
  if (h == null) return "—"
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`
  return `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

// ---------------------------------------------------------------- labels
export const STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  PENDING_MANAGER: "With manager",
  PENDING_AUDITOR: "With auditor",
  PENDING_HEAD: "With finance head",
  NEEDS_CLARIFICATION: "Needs clarification",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  IN_PAYOUT: "In payout",
  PAID: "Paid",
}
export type Tone = "neutral" | "warning" | "positive" | "danger" | "info" | "violet" | "ink"
export const STATUS_TONE: Record<ClaimStatus, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "neutral",
  PENDING_MANAGER: "warning",
  PENDING_AUDITOR: "warning",
  PENDING_HEAD: "warning",
  NEEDS_CLARIFICATION: "violet",
  APPROVED: "positive",
  REJECTED: "danger",
  IN_PAYOUT: "info",
  PAID: "ink",
}

export const FLAG_LABEL: Record<Flag, string> = {
  OVER_LIMIT: "Over limit",
  MISSING_RECEIPT: "No receipt",
  DUPLICATE: "Duplicate",
  WEEKEND: "Weekend",
  NO_POLICY: "No policy",
}
export const FLAG_TONE: Record<Flag, Tone> = {
  OVER_LIMIT: "danger",
  MISSING_RECEIPT: "danger",
  DUPLICATE: "warning",
  WEEKEND: "violet",
  NO_POLICY: "neutral",
}

export const OUTCOME_LABEL: Record<LineOutcome, string> = { AUTO_APPROVE: "Clean", ROUTE: "Routed", AUTO_REJECT: "Auto-rejected" }
export const OUTCOME_TONE: Record<LineOutcome, Tone> = { AUTO_APPROVE: "positive", ROUTE: "warning", AUTO_REJECT: "danger" }

export const CATEGORY_LABEL: Record<Category, string> = {
  HOTEL: "Hotel",
  FLIGHT: "Flight",
  MEALS: "Meals",
  LOCAL_CAB: "Local cab",
  TRAIN: "Train",
  OTHER: "Other",
}
export const CATEGORY_COLOR: Record<Category, string> = {
  HOTEL: "var(--cat-hotel)",
  FLIGHT: "var(--cat-flight)",
  MEALS: "var(--cat-meals)",
  LOCAL_CAB: "var(--cat-cab)",
  TRAIN: "var(--cat-train)",
  OTHER: "var(--cat-other)",
}

export const ROLE_LABEL: Record<Role, string> = { EMPLOYEE: "Employee", MANAGER: "Manager", AUDITOR: "Auditor", HEAD: "Finance head" }
export const LEVEL_LABEL: Record<ApprovalLevel, string> = { MANAGER: "Manager", AUDITOR: "Auditor", HEAD: "Finance head" }
export const LEVEL_FOR_ROLE: Partial<Record<Role, ApprovalLevel>> = { MANAGER: "MANAGER", AUDITOR: "AUDITOR", HEAD: "HEAD" }
