import { z } from "zod"
import type { Category, ClaimLineInput, Flag, PolicyConfig } from "@/api/types"
import { CATEGORY_LABEL, money } from "./format"

/** Local calendar date (YYYY-MM-DD) — NOT UTC, so 00:30 IST is still "today". */
export function localToday(now = new Date()) {
  const d = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 10)
}
export function localDaysAgo(n: number, now = new Date()) {
  return localToday(new Date(now.getTime() - n * 86_400_000))
}

const hasAtMost2Decimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

/* ---------------------------------------------------------------- validation (mirrors README 4.2; server is the authority) */
export const lineSchema = z
  .object({
    category: z.enum(["MEALS", "HOTEL", "LOCAL_CAB", "FLIGHT", "TRAIN", "OTHER"]),
    expenseDate: z
      .string()
      .min(1, "Pick a date")
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date")
      .refine((d) => d <= localToday(), "Can't be in the future")
      .refine((d) => d >= localDaysAgo(90), "Older than 90 days — not claimable"),
    amount: z
      .number({ error: "Enter an amount" })
      .positive("Must be more than 0")
      .max(1_000_000, "Max ₹10,00,000 per line")
      .refine(hasAtMost2Decimals, "Up to 2 decimals"),
    vendor: z.string().trim().min(1, "Who did you pay?").max(120, "Max 120 characters"),
    city: z.string().trim().max(80, "Max 80 characters").optional().nullable(),
    nights: z.number({ error: "Enter nights" }).int("Whole nights only").min(1, "At least 1 night").max(30, "Max 30 nights").optional().nullable(),
    description: z.string().max(500, "Max 500 characters").optional().nullable(),
    receiptId: z.number().optional().nullable(),
  })
  .superRefine((l, ctx) => {
    if (l.category === "HOTEL") {
      if (!l.city?.trim()) ctx.addIssue({ code: "custom", path: ["city"], message: "City is required for hotels" })
      if (l.nights == null || Number.isNaN(l.nights)) ctx.addIssue({ code: "custom", path: ["nights"], message: "Nights required" })
    }
  })

export const claimSchema = z.object({
  title: z.string().trim().min(1, "Give the claim a short title").max(120, "Max 120 characters"),
  lines: z.array(lineSchema).min(1, "Add at least one expense").max(20, "Max 20 lines per claim"),
})
export type ClaimFormValues = z.infer<typeof claimSchema>

/* ---------------------------------------------------------------- client-side policy preview */
export interface LinePreview {
  flags: Flag[]
  notes: string[]
  reject: boolean
}

export function isTier1(city: string | null | undefined, policy: PolicyConfig) {
  const c = (city ?? "").trim().toLowerCase()
  return !!c && policy.tier1Cities.some((t) => t.toLowerCase() === c)
}

export function hotelLimit(tier: 1 | 2, policy?: PolicyConfig) {
  return policy?.rules.find((r) => r.active && r.category === "HOTEL" && r.cityTier === tier)?.limitAmount
}

export function previewLine(l: Partial<ClaimLineInput>, policy: PolicyConfig | undefined, mealsOnDay: number): LinePreview {
  const flags: Flag[] = []
  const notes: string[] = []
  if (!l.amount || !policy) return { flags, notes, reject: false }
  const setting = (k: string, d: number) => Number(policy.settings.find((s) => s.key === k)?.value ?? d)
  const receiptAbove = setting("receipt.required.above", 500)
  let reject = false
  if (l.amount > receiptAbove && !l.receiptId) {
    flags.push("MISSING_RECEIPT")
    notes.push(`Receipt needed above ₹${receiptAbove}`)
    reject = true
  }
  const rule = (code: string) => policy.rules.find((r) => r.code === code && r.active)
  if (l.category === "HOTEL") {
    const tier1 = isTier1(l.city, policy)
    const limit = hotelLimit(tier1 ? 1 : 2, policy)
    const per = l.amount / Math.max(1, l.nights ?? 1)
    if (limit != null && per > limit) {
      flags.push("OVER_LIMIT")
      notes.push(`₹${money(per)}/night is over the ${tier1 ? "tier-1 " : ""}limit of ₹${money(limit)}`)
    }
  } else if (l.category === "MEALS") {
    const r = rule("MEAL_DAILY")
    if (r && mealsOnDay > r.limitAmount) {
      flags.push("OVER_LIMIT")
      notes.push(`Meals that day total ₹${money(mealsOnDay)} — limit ₹${money(r.limitAmount)}`)
    }
  } else if (l.category === "LOCAL_CAB") {
    const r = rule("CAB_TRIP")
    if (r && l.amount > r.limitAmount) {
      flags.push("OVER_LIMIT")
      notes.push(`Over the ₹${money(r.limitAmount)} per-trip limit`)
    }
  } else if (l.category) {
    flags.push("NO_POLICY")
    notes.push(`${CATEGORY_LABEL[l.category as Category]} always gets a manager review`)
  }
  if (l.expenseDate && /^\d{4}-\d{2}-\d{2}$/.test(l.expenseDate)) {
    const d = new Date(l.expenseDate + "T00:00:00").getDay()
    if (d === 0 || d === 6) {
      flags.push("WEEKEND")
      notes.push("Weekend expense — your manager will check it")
    }
  }
  return { flags, notes, reject }
}

export type RouteInfo = { label: string; steps: string[]; tone: "neutral" | "positive" | "warning" | "danger"; detail: string }

/** Strict "above" thresholds (FR-APR-1): exactly 25,000 ends at manager. */
export function approvalChain(total: number, policy?: PolicyConfig) {
  const s = (k: string, d: number) => Number(policy?.settings.find((x) => x.key === k)?.value ?? d)
  const steps = ["Manager"]
  if (total > s("approval.auditor.above", 25000)) steps.push("Auditor")
  if (total > s("approval.head.above", 100000)) steps.push("Finance head")
  return { label: `${steps.length}-step review`, steps }
}

/** Predicts the claim outcome per README 4.3 / R4 / R9 / R16. */
export function predictRoute(total: number, previews: LinePreview[], policy?: PolicyConfig): RouteInfo {
  const s = (k: string, d: number) => Number(policy?.settings.find((x) => x.key === k)?.value ?? d)
  if (!(total > 0)) return { label: "Add an amount", steps: [], tone: "neutral", detail: "Enter amounts to see who will need to approve this claim." }
  if (previews.some((p) => p.reject)) return { label: "Will be rejected", steps: [], tone: "danger", detail: "A line over ₹500 has no receipt. Attach it to avoid an automatic rejection." }
  const clean = previews.every((p) => p.flags.length === 0)
  if (clean && total > 0 && total <= s("auto_approve.max_total", 5000)) return { label: "Auto-approves", steps: [], tone: "positive", detail: "Every line is within policy and the total is small — no approver needed." }
  return { ...approvalChain(total, policy), tone: "warning", detail: clean ? "Total is above the auto-approve limit." : "Some lines are flagged for a human look." }
}
