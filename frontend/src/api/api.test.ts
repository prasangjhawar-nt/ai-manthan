/**
 * Story-level tests of the frontend API layer (src/api/*) against the in-browser mock,
 * which implements contract-v1 and the README business rules. Same assertions should
 * hold against the real backend (see TESTING.md → "Run against the backend").
 */
import { describe, expect, it, vi } from "vitest"
import { Api } from "./endpoints"
import { ApiError, api, newIdempotencyKey, session, setUnauthorizedHandler } from "./client"
import type { ClaimLineInput } from "./types"
import { localDaysAgo } from "@/lib/claim-rules"

async function as(email: string) {
  const r = await Api.login(email, "Demo@123")
  session.save(r.token, r.user, r.expiresInSeconds)
  return r.user
}
const EMP = "emp.demo@expenseflow.test"
const COLLEAGUE = "colleague.demo@expenseflow.test"
const MGR = "mgr.demo@expenseflow.test"
const AUDITOR = "auditor.demo@expenseflow.test"
const HEAD = "head.demo@expenseflow.test"

async function expectProblem(p: Promise<unknown>, status: number) {
  const e = await p.then(
    () => null,
    (x) => x,
  )
  expect(e).toBeInstanceOf(ApiError)
  expect((e as ApiError).status).toBe(status)
  return e as ApiError
}

// A weekday in the past week, so no WEEKEND flag sneaks in
const weekday = (() => {
  for (let i = 1; i < 8; i++) {
    const d = localDaysAgo(i)
    const day = new Date(d + "T00:00:00").getDay()
    if (day !== 0 && day !== 6) return d
  }
  return localDaysAgo(1)
})()

async function receipt() {
  const r = await Api.uploadReceipt(new File([crypto.randomUUID()], "r.png", { type: "image/png" }))
  return r.id
}

describe("ST-01 login & role access", () => {
  it("valid demo credentials return a JWT and the user's role", async () => {
    const r = await Api.login(EMP, "Demo@123")
    expect(r.tokenType).toBe("Bearer")
    expect(r.user.role).toBe("EMPLOYEE")
    expect(r.expiresInSeconds).toBeGreaterThan(0)
  })
  it("wrong password → 401 problem detail", async () => {
    const e = await expectProblem(Api.login(EMP, "nope"), 401)
    expect(e.problem.title).toBe("Unauthorized")
  })
  it("no token on a claim API → 401 and the app is told to log out", async () => {
    const onUnauth = vi.fn()
    setUnauthorizedHandler(onUnauth)
    await expectProblem(Api.listMyClaims(), 401)
    expect(onUnauth).toHaveBeenCalledOnce()
  })
  it("EMPLOYEE calling an approver API → 403", async () => {
    await as(EMP)
    await expectProblem(Api.getApprovalQueue(), 403)
  })
  it("an expired token is dropped client-side", () => {
    session.save("t", { id: 1 }, -10)
    expect(session.token).toBeNull()
  })
})

describe("api() client", () => {
  it("attaches the bearer token from the session", async () => {
    await expectProblem(Api.me(), 401)
    const u = await as(EMP)
    expect((await Api.me()).id).toBe(u.id)
  })
  it("wraps errors as ApiError with the problem body and correlation id", async () => {
    await as(EMP)
    const e = await expectProblem(api("/api/does-not-exist"), 404)
    expect(e.problem.correlationId).toBeTruthy()
  })
})

describe("ST-02 / ST-03 create, submit, policy engine", () => {
  const golden = async (): Promise<ClaimLineInput[]> => [
    { category: "HOTEL", expenseDate: weekday, amount: 22500, vendor: "Hotel Sea Pearl", city: "Mumbai", nights: 3, receiptId: await receipt() },
    { category: "MEALS", expenseDate: weekday, amount: 1200, vendor: "Cafe Madras", city: "Mumbai", receiptId: await receipt() },
    { category: "FLIGHT", expenseDate: weekday, amount: 6000, vendor: "IndiGo", city: "Mumbai", receiptId: await receipt() },
  ]

  it("creates a DRAFT with the computed total, then edits it with optimistic locking", async () => {
    await as(EMP)
    const c = await Api.createClaim({ title: "Mumbai client visit", lines: await golden() }, newIdempotencyKey())
    expect(c.status).toBe("DRAFT")
    expect(c.totalAmount).toBe(29700)
    const u = await Api.updateClaim(c.id, { version: c.version, title: "Mumbai visit", lines: (await golden()).slice(0, 1) })
    expect(u.totalAmount).toBe(22500)
    await expectProblem(Api.updateClaim(c.id, { version: c.version, title: "stale", lines: (await golden()).slice(0, 1) }), 409)
  })

  it("receipts are stored with a SHA-256 hash; same file reports a duplicate", async () => {
    await as(EMP)
    const f = new File(["same-bytes"], "a.png", { type: "image/png" })
    const a = await Api.uploadReceipt(f)
    const b = await Api.uploadReceipt(f)
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(b.duplicateOfReceiptId).toBe(a.id)
  })

  it("rejects unsupported receipt types (415) and files over 5 MB (413)", async () => {
    await as(EMP)
    await expectProblem(Api.uploadReceipt(new File(["x"], "a.gif", { type: "image/gif" })), 415)
    await expectProblem(Api.uploadReceipt(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" })), 413)
  })

  it("validation errors come back as field errors (400)", async () => {
    await as(EMP)
    const e = await expectProblem(Api.createClaim({ title: "x", lines: [{ category: "HOTEL", expenseDate: weekday, amount: 0, vendor: "", city: null, nights: null }] }, newIdempotencyKey()), 400)
    expect(e.problem.errors?.map((f) => f.field)).toEqual(expect.arrayContaining(["lines[0].amount", "lines[0].vendor"]))
  })

  it("submitting twice with the same Idempotency-Key creates one submission", async () => {
    await as(EMP)
    const c = await Api.createClaim({ title: "Golden", lines: await golden() }, newIdempotencyKey())
    const key = newIdempotencyKey()
    const [a, b] = await Promise.all([Api.submitClaim(c.id, key), Api.submitClaim(c.id, key)])
    expect(a.status).toBe("PENDING_MANAGER")
    expect(b).toEqual(a)
    const mine = await Api.listMyClaims()
    expect(mine.content.filter((x) => x.title === "Golden")).toHaveLength(1)
  })

  it("flags OVER_LIMIT (hotel 7,500/night in tier-1) and NO_POLICY (flight) → PENDING_MANAGER", async () => {
    await as(EMP)
    const c = await Api.createClaim({ title: "Flags", lines: await golden() }, newIdempotencyKey())
    const s = await Api.submitClaim(c.id, newIdempotencyKey())
    expect(s.lines[0]).toMatchObject({ outcome: "ROUTE", flags: ["OVER_LIMIT"] })
    expect(s.lines[2].flags).toContain("NO_POLICY")
    expect(s.status).toBe("PENDING_MANAGER")
  })

  it("R4: a line above ₹500 without a receipt rejects the claim with a reason", async () => {
    await as(EMP)
    const c = await Api.createClaim({ title: "No receipt", lines: [{ category: "MEALS", expenseDate: weekday, amount: 800, vendor: "Cafe", city: "Pune" }] }, newIdempotencyKey())
    const s = await Api.submitClaim(c.id, newIdempotencyKey())
    expect(s.status).toBe("REJECTED")
    expect(s.lines[0].flags).toContain("MISSING_RECEIPT")
    expect(s.lines[0].reason).toBeTruthy()
  })

  it("R16: clean claim ≤ ₹5,000 is auto-approved", async () => {
    await as(EMP)
    const c = await Api.createClaim({ title: "Small", lines: [{ category: "LOCAL_CAB", expenseDate: weekday, amount: 420, vendor: "Ola", city: "Pune" }] }, newIdempotencyKey())
    expect((await Api.submitClaim(c.id, newIdempotencyKey())).status).toBe("APPROVED")
  })
})

describe("ST-04 / R13 visibility", () => {
  it("an employee sees only their own claims, and another's claim is a 404 (not 403)", async () => {
    const me = await as(EMP)
    const mine = await Api.listMyClaims()
    expect(mine.content.every((c) => c.employeeId === me.id)).toBe(true)
    await as(COLLEAGUE)
    const theirs = (await Api.listMyClaims()).content[0]
    await as(EMP)
    await expectProblem(Api.getClaim(theirs.id), 404)
  })
})

describe("ST-05 / ST-06 manager decisions", () => {
  it("approving a > ₹25,000 claim moves it to the auditor (R9)", async () => {
    await as(EMP)
    const c = await Api.createClaim({ title: "Big", lines: [{ category: "HOTEL", expenseDate: weekday, amount: 30000, vendor: "Taj", city: "Mumbai", nights: 3, receiptId: await receipt() }] }, newIdempotencyKey())
    await Api.submitClaim(c.id, newIdempotencyKey())
    await as(MGR)
    const q = await Api.getApprovalQueue()
    expect(q.content.map((x) => x.id)).toContain(c.id)
    const r = await Api.approveClaim(c.id, "ok")
    expect(r.status).toBe("PENDING_AUDITOR")
    expect(r.approvalSteps.at(-1)).toMatchObject({ level: "MANAGER", decision: "APPROVED" })
  })

  it("send back requires a comment (400) and yields NEEDS_CLARIFICATION", async () => {
    await as(MGR)
    const id = (await Api.getApprovalQueue()).content[0].id
    await expectProblem(Api.sendBackClaim(id, "  "), 400)
    expect((await Api.sendBackClaim(id, "Attach GST invoice")).status).toBe("NEEDS_CLARIFICATION")
  })

  it("R15: nobody approves their own claim (403)", async () => {
    const mgr = await as(MGR)
    const c = await Api.createClaim({ title: "Own", lines: [{ category: "FLIGHT", expenseDate: weekday, amount: 7000, vendor: "IndiGo", receiptId: await receipt() }] }, newIdempotencyKey())
    await Api.submitClaim(c.id, newIdempotencyKey())
    expect(c.employeeId).toBe(mgr.id)
    await expectProblem(Api.approveClaim(c.id), 403)
  })

  it("R10: an active delegate acts for the approver and the audit row records both", async () => {
    // Rohan reports to Neha (mgr.leave), who delegated to Vikram (mgr.demo) for today ± 3 days.
    await as("rohan.iyer@expenseflow.test")
    const c = await Api.createClaim({ title: "Delegated", lines: [{ category: "FLIGHT", expenseDate: weekday, amount: 7000, vendor: "IndiGo", receiptId: await receipt() }] }, newIdempotencyKey())
    await Api.submitClaim(c.id, newIdempotencyKey())
    await as(MGR)
    expect((await Api.getApprovalQueue()).content.map((x) => x.id)).toContain(c.id)
    const r = await Api.approveClaim(c.id)
    expect(r.approvalSteps.at(-1)).toMatchObject({ approverName: "Neha Kulkarni", actedByName: "Vikram Nair" })
    const audit = await Api.getAuditTrail(c.id)
    expect(audit.at(-1)).toMatchObject({ actorName: "Vikram Nair", onBehalfOfName: "Neha Kulkarni" })
  })

  it("invalid transition → 409", async () => {
    await as(MGR)
    const id = (await Api.getApprovalQueue()).content[0].id
    await Api.rejectClaim(id, "Personal expense")
    await expectProblem(Api.approveClaim(id), 409)
  })
})

describe("ST-07 auditor", () => {
  it("filters by flag and bulk-approves each claim independently", async () => {
    await as(AUDITOR)
    const flagged = await Api.getApprovalQueue({ flag: "OVER_LIMIT" })
    expect(flagged.content.every((c) => c.flags.includes("OVER_LIMIT"))).toBe(true)
    const all = await Api.getApprovalQueue()
    const ids = all.content.filter((c) => c.status === "PENDING_AUDITOR").map((c) => c.id)
    const res = await Api.bulkApprove([...ids, 999999], null, newIdempotencyKey())
    expect(res.processed).toBe(ids.length + 1)
    expect(res.failed).toBe(1)
    expect(res.results.find((r) => r.claimId === 999999)).toMatchObject({ outcome: "SKIPPED", errorStatus: 404 })
  })

  it("can clear an open sample audit; a non-auditor cannot", async () => {
    await as(AUDITOR)
    const s = (await Api.getApprovalQueue({ sampleAuditOnly: true })).content[0]
    expect(s.sampleAudit).toBe("OPEN")
    await as(HEAD)
    await expectProblem(Api.resolveSampleAudit(s.id, "CLEARED"), 403)
    await as(AUDITOR)
    expect((await Api.resolveSampleAudit(s.id, "CLEARED")).sampleAudit).toBe("CLEARED")
  })
})

describe("ST-08 / ST-09 / ST-10 finance head", () => {
  it("creates a payout batch: claims go IN_PAYOUT and the batch waits for the bank", async () => {
    await as(HEAD)
    const eligible = await Api.listPayoutEligible()
    expect(eligible.content.every((c) => c.status === "APPROVED" && c.sampleAudit !== "OPEN")).toBe(true)
    const b = await Api.createPayoutBatch(eligible.content.map((c) => c.id), newIdempotencyKey())
    expect(b.status).toBe("PENDING_SEND")
    expect(b.claims?.every((c) => c.status === "IN_PAYOUT")).toBe(true)
    const retried = await Api.retryPayoutBatch(b.id)
    expect(retried.status).toBe("SENT")
    expect(retried.bankReference).toMatch(/^BNK-/)
    const csv = await (await Api.downloadPayoutFile(b.id)).text()
    expect(csv.split("\n")[0]).toBe("batch_ref,claim_number,employee_code,employee_name,account_number,ifsc,amount_inr,narration")
  })

  it("dashboard is HEAD/AUDITOR only and returns KPIs + charts", async () => {
    await as(MGR)
    await expectProblem(Api.getDashboard(), 403)
    await as(HEAD)
    const d = await Api.getDashboard()
    expect(Object.keys(d.kpis.pendingByLevel)).toEqual(["MANAGER", "AUDITOR", "HEAD"])
    expect(d.spendByCategory.length).toBeGreaterThan(0)
  })
})

describe("ST-11 audit trail", () => {
  it("every action writes one audit row with from/to status", async () => {
    await as(EMP)
    const c = await Api.createClaim({ title: "Audit me", lines: [{ category: "LOCAL_CAB", expenseDate: weekday, amount: 300, vendor: "Ola" }] }, newIdempotencyKey())
    await Api.submitClaim(c.id, newIdempotencyKey())
    await Api.addComment(c.id, "FYI")
    const a = await Api.getAuditTrail(c.id)
    expect(a.map((x) => x.action)).toEqual(["CLAIM_CREATED", "CLAIM_SUBMITTED", "COMMENT_ADDED"])
    expect(a[1]).toMatchObject({ fromStatus: "DRAFT", toStatus: "APPROVED" })
  })
})
