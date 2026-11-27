import { describe, expect, it } from "vitest"
import { STATUS_LABEL, STATUS_TONE, hours, initials, money, money0, moneyCompact } from "./format"
import type { ClaimStatus } from "@/api/types"

describe("money formatting (INR, Indian grouping)", () => {
  it("formats with 2 decimals and lakh grouping", () => {
    expect(money(30500)).toBe("30,500.00")
    expect(money(145000)).toBe("1,45,000.00")
    expect(money(null)).toBe("—")
  })
  it("money0 drops decimals", () => {
    expect(money0(1234567.8)).toBe("12,34,568")
  })
  it("compact units for charts", () => {
    expect(moneyCompact(18452300)).toBe("1.85 Cr")
    expect(moneyCompact(512040)).toBe("5.1 L")
    expect(moneyCompact(30500)).toBe("30.5K")
    expect(moneyCompact(900)).toBe("900")
  })
})

describe("durations and names", () => {
  it("hours → human", () => {
    expect(hours(0.5)).toBe("30m")
    expect(hours(5.25)).toBe("5.3h")
    expect(hours(20.4)).toBe("20h")
    expect(hours(74.5)).toBe("3d 3h")
    expect(hours(null)).toBe("—")
  })
  it("initials", () => {
    expect(initials("Asha Verma")).toBe("AV")
    expect(initials("Meera")).toBe("M")
  })
})

describe("status language covers every ClaimStatus", () => {
  const all: ClaimStatus[] = ["DRAFT", "SUBMITTED", "PENDING_MANAGER", "PENDING_AUDITOR", "PENDING_HEAD", "NEEDS_CLARIFICATION", "APPROVED", "REJECTED", "IN_PAYOUT", "PAID"]
  it.each(all)("%s has a label and tone", (s) => {
    expect(STATUS_LABEL[s]).toBeTruthy()
    expect(STATUS_TONE[s]).toBeTruthy()
  })
})
