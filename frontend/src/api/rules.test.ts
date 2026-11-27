/**
 * Integration tests for business rules and permissions not covered in api.test.ts.
 * They exercise src/api/* end to end against the contract mock (README §4–5).
 */
import { describe, expect, it } from "vitest"
import { Api } from "./endpoints"
import { ApiError, newIdempotencyKey, session } from "./client"
import type { ClaimLineInput } from "./types"
import { localDaysAgo } from "@/lib/claim-rules"

const EMP = "emp.demo@expenseflow.test"
const MGR = "mgr.demo@expenseflow.test"
const MGR_LEAVE = "mgr.leave@expenseflow.test"
const AUDITOR = "auditor.demo@expenseflow.test"
const HEAD = "head.demo@expenseflow.test"

async function as(email: string) {
  const r = await Api.login(email, "Demo@123")
  session.save(r.token, r.user, r.expiresInSeconds)
  return r.user
}
async function status(p: Promise<unknown>) {
  try {
    await p
    return 200
  } catch (e) {
    return (e as ApiError).status
  }
}
const weekday = (() => {
  for (let i = 1; i < 8; i++) {
    const d = localDaysAgo(i)
    const day = new Date(d + "T00:00:00").getDay()
    if (day !== 0 && day !== 6) return d
  }
  return localDaysAgo(1)
})()
const receipt = async (bytes = crypto.randomUUID()) => (await Api.uploadReceipt(new File([bytes], "r.png", { type: "image/png" }))).id
async function submitAs(email: string, title: string, lines: ClaimLineInput[]) {
  await as(email)
  const c = await Api.createClaim({ title, lines }, newIdempotencyKey())
  return Api.submitClaim(c.id, newIdempotencyKey())
}

describe("R5 duplicates", () => {
  it("same vendor + amount + date as an earlier claim is flagged DUPLICATE and routed", async () => {
    const line = async (): Promise<ClaimLineInput> => ({ category: "LOCAL_CAB", expenseDate: weekday, amount: 450, vendor: "Ola", city: "Pune", receiptId: await receipt() })
    await as(EMP)
    await submitAs(EMP, "First", [await line()])
    await as(EMP)
    const second = await submitAs(EMP, "Second", [await line()])
    expect(second.lines[0].flags).toContain("DUPLICATE")
    expect(second.lines[0].outcome).toBe("ROUTE")
    expect(second.status).toBe("PENDING_MANAGER")
  })

  it("uploading the same file twice reports the earlier receipt (hash match)", async () => {
    await as(EMP)
    const a = await Api.uploadReceipt(new File(["identical"], "a.png", { type: "image/png" }))
    const b = await Api.uploadReceipt(new File(["identical"], "b.png", { type: "image/png" }))
    expect(a.sha256).toBe(b.sha256)
    expect(b.duplicateOfReceiptId).toBe(a.id)
  })
})

describe("R9 full chain up to finance head", () => {
  it("> ₹1,00,000: manager → auditor → head → Approved, with one approval step per level", async () => {
    await as(EMP)
    const s = await submitAs(EMP, "Offsite", [{ category: "HOTEL", expenseDate: weekday, amount: 120000, vendor: "Resort", city: "Goa", nights: 4, receiptId: await receipt() }])
    expect(s.status).toBe("PENDING_MANAGER")
    await as(MGR)
    expect((await Api.approveClaim(s.id)).status).toBe("PENDING_AUDITOR")
    await as(AUDITOR)
    expect((await Api.approveClaim(s.id)).status).toBe("PENDING_HEAD")
    await as(HEAD)
    const done = await Api.approveClaim(s.id, "OK")
    expect(done.status).toBe("APPROVED")
    expect(done.approvalSteps.map((x) => x.level)).toEqual(["MANAGER", "AUDITOR", "HEAD"])
    expect(done.finalDecisionAt).toBeTruthy()
  })

  it("an approver at the wrong level is refused (403)", async () => {
    await as(EMP)
    const s = await submitAs(EMP, "Wrong level", [{ category: "FLIGHT", expenseDate: weekday, amount: 8000, vendor: "IndiGo", receiptId: await receipt() }])
    await as(AUDITOR)
    expect(await status(Api.approveClaim(s.id))).toBe(403) // PENDING_MANAGER is not the auditor's
    await as(HEAD)
    expect(await status(Api.approveClaim(s.id))).toBe(403)
  })

  it("a manager who isn't the claimant's manager (and no delegation) is refused", async () => {
    await as(EMP)
    const s = await submitAs(EMP, "Not your team", [{ category: "FLIGHT", expenseDate: weekday, amount: 8000, vendor: "IndiGo", receiptId: await receipt() }])
    await as(MGR_LEAVE)
    // mgr.leave isn't Asha's manager; the claim isn't even visible → 404 (R13)
    expect(await status(Api.approveClaim(s.id))).toBe(404)
  })
})

describe("FR-APR-2 reject / send back", () => {
  it("reject needs a reason (400) and ends the claim (REJECTED, final)", async () => {
    await as(EMP)
    const s = await submitAs(EMP, "To reject", [{ category: "FLIGHT", expenseDate: weekday, amount: 8000, vendor: "IndiGo", receiptId: await receipt() }])
    await as(MGR)
    expect(await status(Api.rejectClaim(s.id, ""))).toBe(400)
    const r = await Api.rejectClaim(s.id, "Personal travel")
    expect(r.status).toBe("REJECTED")
    expect(r.approvalSteps.at(-1)).toMatchObject({ decision: "REJECTED", comment: "Personal travel" })
    const comments = await Api.listComments(s.id)
    expect(comments.at(-1)?.body).toBe("Personal travel")
  })

  it("R17: resubmission re-runs policy and restarts at the manager", async () => {
    await as(EMP)
    const s = await submitAs(EMP, "Resubmit", [{ category: "HOTEL", expenseDate: weekday, amount: 30000, vendor: "Taj", city: "Mumbai", nights: 3, receiptId: await receipt() }])
    await as(MGR)
    await Api.approveClaim(s.id) // → auditor
    await as(AUDITOR)
    await Api.sendBackClaim(s.id, "Split the bill")
    await as(EMP)
    const c = await Api.getClaim(s.id)
    expect(c.status).toBe("NEEDS_CLARIFICATION")
    // now within limit: 3 × 5,000
    await Api.updateClaim(s.id, { version: c.version, title: c.title, lines: [{ category: "HOTEL", expenseDate: weekday, amount: 15000, vendor: "Taj", city: "Mumbai", nights: 3, receiptId: c.lines[0].receiptId }] })
    const again = await Api.submitClaim(s.id, newIdempotencyKey())
    expect(again.status).toBe("PENDING_MANAGER")
    expect(again.currentLevel).toBe("MANAGER")
    expect(again.lines[0].flags).not.toContain("OVER_LIMIT")
  })

  it("claims can only be edited while DRAFT or NEEDS_CLARIFICATION (409)", async () => {
    await as(EMP)
    const s = await submitAs(EMP, "Locked", [{ category: "FLIGHT", expenseDate: weekday, amount: 8000, vendor: "IndiGo", receiptId: await receipt() }])
    expect(await status(Api.updateClaim(s.id, { version: s.version, title: "x", lines: s.lines }))).toBe(409)
    expect(await status(Api.submitClaim(s.id, newIdempotencyKey()))).toBe(409)
  })

  it("only the owner can edit or submit (others can't even see it → 404, or 403 if visible)", async () => {
    await as(EMP)
    const s = await submitAs(EMP, "Mine", [{ category: "MEALS", expenseDate: weekday, amount: 200, vendor: "Cafe" }])
    await as(MGR) // can see it (direct report) but isn't the owner
    expect(await status(Api.updateClaim(s.id, { version: s.version, title: "x", lines: s.lines }))).toBe(403)
  })
})

describe("R11 sample audit", () => {
  it("FAILED rejects an approved claim and removes it from payout", async () => {
    await as(AUDITOR)
    const s = (await Api.getApprovalQueue({ sampleAuditOnly: true })).content[0]
    expect(await status(Api.resolveSampleAudit(s.id, "FAILED", "Receipt doesn't match"))).toBe(200)
    const c = await Api.getClaim(s.id)
    expect(c.status).toBe("REJECTED")
    expect(c.sampleAudit).toBe("FAILED")
    await as(HEAD)
    expect((await Api.listPayoutEligible()).content.map((x) => x.id)).not.toContain(s.id)
    await as(AUDITOR)
    expect(await status(Api.resolveSampleAudit(s.id, "CLEARED"))).toBe(409) // no longer open
  })

  it("claims with an OPEN sample audit are not payout-eligible (R12)", async () => {
    await as(AUDITOR)
    const open = (await Api.getApprovalQueue({ sampleAuditOnly: true })).content[0]
    await as(HEAD)
    expect((await Api.listPayoutEligible()).content.map((x) => x.id)).not.toContain(open.id)
  })
})

describe("R10 delegation API", () => {
  it("lists delegations given and received", async () => {
    await as(MGR)
    const list = await Api.listDelegations()
    expect(list.some((d) => d.delegateName === "Vikram Nair" && d.approverName === "Neha Kulkarni" && d.active)).toBe(true)
  })
  it("validates the date range and the delegate", async () => {
    await as(MGR)
    expect(await status(Api.createDelegation({ delegateId: 34, fromDate: "2026-12-10", toDate: "2026-12-01" }))).toBe(400)
    expect(await status(Api.createDelegation({ delegateId: 999999, fromDate: "2026-12-01", toDate: "2026-12-10" }))).toBe(400)
    const d = await Api.createDelegation({ delegateId: 34, fromDate: "2030-01-01", toDate: "2030-01-05" })
    expect(d.active).toBe(false) // future
  })
  it("employees can't delegate (403)", async () => {
    await as(EMP)
    expect(await status(Api.listDelegations())).toBe(403)
  })
})

describe("payout & dashboard permissions", () => {
  it("payout endpoints are HEAD only", async () => {
    await as(AUDITOR)
    expect(await status(Api.listPayoutEligible())).toBe(403)
    expect(await status(Api.listPayoutBatches())).toBe(403)
  })
  it("batch detail includes its claims; list omits them", async () => {
    await as(HEAD)
    const ids = (await Api.listPayoutEligible()).content.map((c) => c.id)
    const b = await Api.createPayoutBatch(ids, newIdempotencyKey())
    const list = await Api.listPayoutBatches()
    expect(list.content[0].claims).toBeNull()
    const detail = await Api.getPayoutBatch(b.id)
    expect(detail.claims?.map((c) => c.id).sort()).toEqual([...ids].sort())
    expect(await status(Api.createPayoutBatch(ids, newIdempotencyKey()))).toBe(409) // already in payout
  })
  it("same Idempotency-Key on create batch returns the same batch", async () => {
    await as(HEAD)
    const ids = (await Api.listPayoutEligible()).content.map((c) => c.id)
    const key = newIdempotencyKey()
    const a = await Api.createPayoutBatch(ids, key)
    const b = await Api.createPayoutBatch(ids, key)
    expect(b.id).toBe(a.id)
    expect((await Api.listPayoutBatches()).content).toHaveLength(1)
  })
  it("dashboard honours the date range and lists the oldest pending first", async () => {
    await as(AUDITOR)
    const d = await Api.getDashboard("2026-01-01", "2026-06-30")
    expect(d.from).toBe("2026-01-01")
    const w = d.exceptions.map((e) => e.waitingHours ?? 0)
    expect([...w].sort((a, b) => b - a)).toEqual(w)
  })
})

describe("comments & policy", () => {
  it("empty comments are rejected (400); valid ones are listed and audited", async () => {
    await as(EMP)
    const s = await submitAs(EMP, "Comment me", [{ category: "MEALS", expenseDate: weekday, amount: 200, vendor: "Cafe" }])
    expect(await status(Api.addComment(s.id, "   "))).toBe(400)
    await Api.addComment(s.id, "Meeting with client")
    expect((await Api.listComments(s.id)).map((c) => c.body)).toContain("Meeting with client")
    expect((await Api.getAuditTrail(s.id)).some((a) => a.action === "COMMENT_ADDED")).toBe(true)
  })
  it("policy config exposes limits, thresholds and tier-1 cities to every role", async () => {
    await as(EMP)
    const p = await Api.getPolicy()
    expect(p.rules.find((r) => r.code === "HOTEL_T1")?.limitAmount).toBe(6000)
    expect(p.settings.find((s) => s.key === "approval.auditor.above")?.value).toBe("25000")
    expect(p.tier1Cities).toContain("Mumbai")
  })
})
