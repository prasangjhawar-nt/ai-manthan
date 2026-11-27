import { describe, expect, it } from "vitest"
import type { PolicyConfig } from "@/api/types"
import { approvalChain, claimSchema, lineSchema, localDaysAgo, localToday, predictRoute, previewLine } from "./claim-rules"

const policy: PolicyConfig = {
  rules: [
    { id: 1, code: "MEAL_DAILY", category: "MEALS", limitAmount: 1500, unit: "PER_DAY", cityTier: null, active: true },
    { id: 2, code: "HOTEL_T1", category: "HOTEL", limitAmount: 6000, unit: "PER_NIGHT", cityTier: 1, active: true },
    { id: 3, code: "HOTEL_OTHER", category: "HOTEL", limitAmount: 4000, unit: "PER_NIGHT", cityTier: 2, active: true },
    { id: 4, code: "CAB_TRIP", category: "LOCAL_CAB", limitAmount: 2000, unit: "PER_TRIP", cityTier: null, active: true },
  ],
  settings: [
    { key: "receipt.required.above", value: "500" },
    { key: "auto_approve.max_total", value: "5000" },
    { key: "approval.auditor.above", value: "25000" },
    { key: "approval.head.above", value: "100000" },
  ],
  tier1Cities: ["Mumbai", "Delhi", "Bengaluru"],
}

// A fixed weekday (Wed 25 Nov 2026) and a Saturday (21 Nov 2026), both within 90 days of "today" in these tests.
const WEEKDAY = localDaysAgo(0)
const lastSaturday = (() => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7))
  return localToday(d)
})()
const lastWeekday = (() => {
  const d = new Date()
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return localToday(d)
})()

const line = (o: Record<string, unknown> = {}) => ({ category: "MEALS", expenseDate: lastWeekday, amount: 400, vendor: "Cafe", city: "", nights: null, description: "", receiptId: null, ...o })
const issues = (o: Record<string, unknown>) => {
  const r = lineSchema.safeParse(line(o))
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
}

describe("localToday (timezone safety)", () => {
  it("uses the local calendar date, not UTC", () => {
    // 00:30 local on 1 Jan must still be 1 Jan locally
    const d = new Date(2026, 0, 1, 0, 30)
    expect(localToday(d)).toBe("2026-01-01")
  })
  it("today's date is accepted (not 'in the future')", () => {
    expect(issues({ expenseDate: WEEKDAY })).toEqual([])
  })
})

describe("line validation (README 4.2 — mirrors server)", () => {
  it("rejects a future date", () => {
    expect(issues({ expenseDate: localDaysAgo(-1) })).toContain("expenseDate: Can't be in the future")
  })
  it("rejects a date older than 90 days, accepts exactly 90", () => {
    expect(issues({ expenseDate: localDaysAgo(91) })[0]).toMatch(/Older than 90 days/)
    expect(issues({ expenseDate: localDaysAgo(90) })).toEqual([])
  })
  it("amount must be > 0, ≤ 10,00,000 and have at most 2 decimals", () => {
    expect(issues({ amount: 0 })).toContain("amount: Must be more than 0")
    expect(issues({ amount: -5 })).toContain("amount: Must be more than 0")
    expect(issues({ amount: 1_000_000.01 })[0]).toMatch(/Max/)
    expect(issues({ amount: 12.345 })).toContain("amount: Up to 2 decimals")
    expect(issues({ amount: 1_000_000 })).toEqual([])
    expect(issues({ amount: 0.1 + 0.2 })).toEqual([]) // float noise is tolerated
  })
  it("amount missing (NaN from an empty number input) gives a friendly error", () => {
    expect(issues({ amount: Number.NaN }).join()).toMatch(/amount/)
  })
  it("vendor is required and trimmed", () => {
    expect(issues({ vendor: "   " })).toContain("vendor: Who did you pay?")
    expect(issues({ vendor: "x".repeat(121) })).toContain("vendor: Max 120 characters")
  })
  it("HOTEL requires city and nights (1–30)", () => {
    const e = issues({ category: "HOTEL", city: "", nights: null })
    expect(e).toContain("city: City is required for hotels")
    expect(e).toContain("nights: Nights required")
    expect(issues({ category: "HOTEL", city: "Mumbai", nights: 0 })).toContain("nights: At least 1 night")
    expect(issues({ category: "HOTEL", city: "Mumbai", nights: 31 })).toContain("nights: Max 30 nights")
    expect(issues({ category: "HOTEL", city: "Mumbai", nights: 2.5 })).toContain("nights: Whole nights only")
    expect(issues({ category: "HOTEL", city: "Mumbai", nights: 3 })).toEqual([])
  })
  it("city/nights are optional for other categories", () => {
    expect(issues({ category: "LOCAL_CAB", city: "", nights: null })).toEqual([])
  })
})

describe("claim validation", () => {
  it("needs a title and 1–20 lines", () => {
    expect(claimSchema.safeParse({ title: " ", lines: [line()] }).success).toBe(false)
    expect(claimSchema.safeParse({ title: "Trip", lines: [] }).success).toBe(false)
    expect(claimSchema.safeParse({ title: "Trip", lines: Array.from({ length: 21 }, () => line()) }).success).toBe(false)
    expect(claimSchema.safeParse({ title: "Trip", lines: Array.from({ length: 20 }, () => line()) }).success).toBe(true)
  })
})

describe("policy preview (R1–R6)", () => {
  it("R4: above ₹500 without a receipt auto-rejects; exactly ₹500 does not", () => {
    expect(previewLine({ category: "MEALS", amount: 501, expenseDate: lastWeekday }, policy, 501)).toMatchObject({ reject: true, flags: ["MISSING_RECEIPT"] })
    expect(previewLine({ category: "MEALS", amount: 500, expenseDate: lastWeekday }, policy, 500).reject).toBe(false)
    expect(previewLine({ category: "MEALS", amount: 900, expenseDate: lastWeekday, receiptId: 7 }, policy, 900).reject).toBe(false)
  })
  it("R2: hotel limit is per night and depends on city tier (case-insensitive)", () => {
    const base = { category: "HOTEL" as const, expenseDate: lastWeekday, receiptId: 1 }
    expect(previewLine({ ...base, amount: 22500, nights: 3, city: "mumbai" }, policy, 0).flags).toEqual(["OVER_LIMIT"]) // 7,500 > 6,000
    expect(previewLine({ ...base, amount: 18000, nights: 3, city: "Mumbai" }, policy, 0).flags).toEqual([]) // 6,000 = limit
    expect(previewLine({ ...base, amount: 4500, nights: 1, city: "Goa" }, policy, 0).flags).toEqual(["OVER_LIMIT"]) // other city 4,000
  })
  it("R1: meals are limited per day across lines", () => {
    expect(previewLine({ category: "MEALS", amount: 900, expenseDate: lastWeekday, receiptId: 1 }, policy, 1600).flags).toEqual(["OVER_LIMIT"])
    expect(previewLine({ category: "MEALS", amount: 900, expenseDate: lastWeekday, receiptId: 1 }, policy, 1500).flags).toEqual([])
  })
  it("R3: cab above ₹2,000 per trip", () => {
    expect(previewLine({ category: "LOCAL_CAB", amount: 2001, expenseDate: lastWeekday, receiptId: 1 }, policy, 0).flags).toEqual(["OVER_LIMIT"])
  })
  it("R6: weekend spend is flagged", () => {
    expect(previewLine({ category: "LOCAL_CAB", amount: 300, expenseDate: lastSaturday }, policy, 0).flags).toContain("WEEKEND")
  })
  it("categories without a rule get NO_POLICY", () => {
    expect(previewLine({ category: "FLIGHT", amount: 6000, expenseDate: lastWeekday, receiptId: 1 }, policy, 0).flags).toEqual(["NO_POLICY"])
  })
})

describe("routing (R9, R16)", () => {
  const clean = { flags: [], notes: [], reject: false }
  const flagged = { flags: ["WEEKEND" as const], notes: [], reject: false }
  it("R16: auto-approves only when every line is clean and total ≤ 5,000", () => {
    expect(predictRoute(5000, [clean], policy).label).toBe("Auto-approves")
    expect(predictRoute(5000.01, [clean], policy).label).toBe("1-step review")
    expect(predictRoute(800, [flagged], policy).label).toBe("1-step review")
  })
  it("R9: thresholds are strict 'above' — exactly 25,000 stays with the manager", () => {
    expect(approvalChain(25000).steps).toEqual(["Manager"])
    expect(approvalChain(25000.01).steps).toEqual(["Manager", "Auditor"])
    expect(approvalChain(100000).steps).toEqual(["Manager", "Auditor"])
    expect(approvalChain(100000.01).steps).toEqual(["Manager", "Auditor", "Finance head"])
  })
  it("an empty claim doesn't pretend to need a review", () => {
    expect(predictRoute(0, [clean], policy).label).toBe("Add an amount")
  })
  it("a rejected line wins over everything", () => {
    expect(predictRoute(200000, [clean, { flags: ["MISSING_RECEIPT"], notes: [], reject: true }], policy).tone).toBe("danger")
  })
})
