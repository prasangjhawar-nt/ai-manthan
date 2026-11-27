/**
 * In-browser mock of the ExpenseFlow API (contract-v1), used by `npm run dev:mock`.
 * Stateful: policy engine, approval chain (R9), visibility (R13), self-approval (R15),
 * delegation (R10), bulk approve, sample audit, payouts with a flaky bank (R12), audit trail (R14).
 * State is kept in sessionStorage so a page reload keeps your demo data.
 */
import type {
  ApprovalLevel,
  AuditEvent,
  Category,
  Claim,
  ClaimLine,
  ClaimLineInput,
  ClaimStatus,
  ClaimSummary,
  Comment,
  Delegation,
  Flag,
  LineOutcome,
  PayoutBatch,
  PolicyConfig,
  ProblemDetail,
  ReceiptUpload,
  User,
} from "./types"

const STORE_KEY = "ef.mockdb.v1"
const TIER1 = ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Kolkata", "Hyderabad", "Pune", "Ahmedabad"]

const USERS: (User & { password: string })[] = [
  { id: 101, employeeCode: "E0101", name: "Asha Verma", email: "emp.demo@expenseflow.test", role: "EMPLOYEE", departmentId: 1, departmentName: "Engineering", managerId: 21, password: "Demo@123" },
  { id: 102, employeeCode: "E0102", name: "Dev Sharma", email: "colleague.demo@expenseflow.test", role: "EMPLOYEE", departmentId: 1, departmentName: "Engineering", managerId: 21, password: "Demo@123" },
  { id: 21, employeeCode: "E0021", name: "Vikram Nair", email: "mgr.demo@expenseflow.test", role: "MANAGER", departmentId: 1, departmentName: "Engineering", managerId: 1, password: "Demo@123" },
  { id: 34, employeeCode: "E0034", name: "Neha Kulkarni", email: "mgr.leave@expenseflow.test", role: "MANAGER", departmentId: 2, departmentName: "Sales", managerId: 1, password: "Demo@123" },
  { id: 5, employeeCode: "E0005", name: "Kavya Reddy", email: "auditor.demo@expenseflow.test", role: "AUDITOR", departmentId: 9, departmentName: "Finance", managerId: 1, password: "Demo@123" },
  { id: 1, employeeCode: "E0001", name: "Meera Krishnan", email: "head.demo@expenseflow.test", role: "HEAD", departmentId: 9, departmentName: "Finance", managerId: null, password: "Demo@123" },
  { id: 117, employeeCode: "E0117", name: "Rohan Iyer", email: "rohan.iyer@expenseflow.test", role: "EMPLOYEE", departmentId: 2, departmentName: "Sales", managerId: 34, password: "Demo@123" },
  { id: 129, employeeCode: "E0129", name: "Karan Malhotra", email: "karan.m@expenseflow.test", role: "EMPLOYEE", departmentId: 3, departmentName: "Operations", managerId: 34, password: "Demo@123" },
  { id: 133, employeeCode: "E0133", name: "Priya Menon", email: "priya.m@expenseflow.test", role: "EMPLOYEE", departmentId: 4, departmentName: "Marketing", managerId: 21, password: "Demo@123" },
]

interface Db {
  seq: number
  claims: Claim[]
  comments: Comment[]
  audit: AuditEvent[]
  batches: PayoutBatch[]
  receipts: ReceiptUpload[]
  delegations: Delegation[]
  idem: Record<string, unknown>
}

const now = () => new Date().toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const daysAgoDate = (d: number) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10)
const userById = (id: number) => USERS.find((u) => u.id === id)!
const round2 = (n: number) => Math.round(n * 100) / 100

let db = {} as Db
const blobs = new Map<number, Blob>()
const inflight = new Map<string, Promise<Response>>()

function load(): Db {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* fresh seed */
  }
  return seed()
}
function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(db))
  } catch {
    /* storage full or blocked — in-memory only */
  }
}
const nextId = () => ++db.seq

// ---------------------------------------------------------------- policy engine
function evaluate(lines: ClaimLineInput[], employeeId: number, excludeClaimId?: number): ClaimLine[] {
  const mealsPerDay = new Map<string, number>()
  for (const l of lines) if (l.category === "MEALS") mealsPerDay.set(l.expenseDate, (mealsPerDay.get(l.expenseDate) ?? 0) + l.amount)
  const others = db.claims.filter((c) => c.employeeId === employeeId && c.id !== excludeClaimId && c.status !== "DRAFT").flatMap((c) => c.lines)

  return lines.map((l, i) => {
    const flags: Flag[] = []
    const reasons: string[] = []
    let outcome: LineOutcome = "AUTO_APPROVE"
    const fmt = (n: number) => n.toLocaleString("en-IN")
    if (l.amount > 500 && !l.receiptId) {
      flags.push("MISSING_RECEIPT")
      reasons.push(`Receipt required above 500`)
      outcome = "AUTO_REJECT"
    }
    if (l.category === "HOTEL") {
      const tier1 = TIER1.some((c) => c.toLowerCase() === (l.city ?? "").trim().toLowerCase())
      const limit = tier1 ? 6000 : 4000
      const perNight = l.amount / Math.max(1, l.nights ?? 1)
      if (perNight > limit) {
        flags.push("OVER_LIMIT")
        reasons.push(`${fmt(round2(perNight))} per night is above the ${tier1 ? "tier-1 " : ""}limit of ${fmt(limit)}`)
      }
    } else if (l.category === "MEALS") {
      if ((mealsPerDay.get(l.expenseDate) ?? 0) > 1500) {
        flags.push("OVER_LIMIT")
        reasons.push("Meals above 1,500 for the day")
      }
    } else if (l.category === "LOCAL_CAB") {
      if (l.amount > 2000) {
        flags.push("OVER_LIMIT")
        reasons.push("Cab above 2,000 per trip")
      }
    } else {
      flags.push("NO_POLICY")
      reasons.push(`No auto-approve policy for ${l.category}`)
    }
    const day = new Date(l.expenseDate + "T00:00:00").getDay()
    if (day === 0 || day === 6) {
      flags.push("WEEKEND")
      reasons.push(`Expense on a ${day === 0 ? "Sunday" : "Saturday"}`)
    }
    if (others.some((o) => o.vendor.toLowerCase() === l.vendor.toLowerCase() && o.amount === l.amount && o.expenseDate === l.expenseDate)) {
      flags.push("DUPLICATE")
      reasons.push("Same vendor, amount and date as an earlier claim")
    }
    if (outcome !== "AUTO_REJECT" && flags.length) outcome = "ROUTE"
    return { ...l, id: nextId(), lineNo: i + 1, outcome, flags, reason: reasons.join(" · ") || null }
  })
}

function draftLines(lines: ClaimLineInput[]): ClaimLine[] {
  return lines.map((l, i) => ({ ...l, id: nextId(), lineNo: i + 1, outcome: null, flags: [], reason: null }))
}

// ---------------------------------------------------------------- helpers
function audit(actor: User, action: AuditEvent["action"], claim: Claim | null, from: ClaimStatus | null, to: ClaimStatus | null, details: Record<string, unknown> | null = null, onBehalfOf?: User) {
  db.audit.push({
    id: nextId(),
    actorId: actor.id,
    actorName: actor.name,
    onBehalfOfId: onBehalfOf?.id ?? null,
    onBehalfOfName: onBehalfOf?.name ?? null,
    action,
    entityType: "CLAIM",
    entityId: claim?.id ?? 0,
    claimId: claim?.id ?? null,
    fromStatus: from,
    toStatus: to,
    details,
    correlationId: Math.random().toString(16).slice(2, 18),
    createdAt: now(),
  })
}

const flagsOf = (c: Claim) => [...new Set(c.lines.flatMap((l) => l.flags))]
function summary(c: Claim): ClaimSummary {
  const lastMove = [...db.audit].reverse().find((a) => a.claimId === c.id && a.toStatus === c.status)?.createdAt ?? c.updatedAt
  const pending = c.status.startsWith("PENDING_")
  return {
    id: c.id,
    claimNumber: c.claimNumber,
    title: c.title,
    status: c.status,
    totalAmount: c.totalAmount,
    employeeId: c.employeeId,
    employeeName: c.employeeName,
    departmentName: c.departmentName,
    submittedAt: c.submittedAt,
    flags: flagsOf(c),
    sampleAudit: c.sampleAudit,
    currentLevel: c.currentLevel,
    waitingHours: pending ? round2((Date.now() - new Date(lastMove).getTime()) / 3600_000) : null,
  }
}
const page = <T,>(content: T[]) => ({ content, page: 0, size: Math.max(20, content.length), totalElements: content.length, totalPages: 1 })

function activeDelegatorsOf(userId: number) {
  const today = new Date().toISOString().slice(0, 10)
  return db.delegations.filter((d) => d.delegateId === userId && d.fromDate <= today && today <= d.toDate).map((d) => d.approverId)
}

function canView(u: User, c: Claim) {
  if (u.role === "AUDITOR" || u.role === "HEAD") return true
  if (c.employeeId === u.id) return true
  if (u.role === "MANAGER") {
    const owner = userById(c.employeeId)
    return owner?.managerId === u.id || activeDelegatorsOf(u.id).includes(owner?.managerId ?? -1)
  }
  return false
}

function recalc(c: Claim) {
  c.totalAmount = round2(c.lines.reduce((s, l) => s + l.amount, 0))
}

function claimNumber(id: number) {
  return `EXP-2026-${String(id).padStart(6, "0")}`
}

// ---------------------------------------------------------------- seed
function seed(): Db {
  db = { seq: 1000, claims: [], comments: [], audit: [], batches: [], receipts: [], delegations: [], idem: {} }
  db.delegations.push({ id: 61, approverId: 34, approverName: "Neha Kulkarni", delegateId: 21, delegateName: "Vikram Nair", fromDate: daysAgoDate(3), toDate: daysAgoDate(-3), active: true, createdAt: hoursAgo(80) })

  type L = [Category, number, number, string, string?, number?]
  const mk = (empId: number, title: string, status: ClaimStatus, ageH: number, lines: L[], extra: Partial<Claim> = {}) => {
    const emp = userById(empId)
    const id = 120 + db.claims.length
    const input: ClaimLineInput[] = lines.map(([category, daysBack, amount, vendor, city, nights]) => {
      const rid = nextId()
      db.receipts.push({ id: rid, fileName: `${vendor.toLowerCase().replace(/\W+/g, "-")}.png`, contentType: "image/png", sizeBytes: 120_000 + rid * 13, sha256: rid.toString(16).padStart(64, "a"), duplicateOfReceiptId: null, uploadedAt: hoursAgo(ageH + 1) })
      return { category, expenseDate: daysAgoDate(daysBack), amount, vendor, city: city ?? "Mumbai", nights: nights ?? null, description: null, receiptId: rid }
    })
    const evaluated = status === "DRAFT" ? draftLines(input) : evaluate(input, empId)
    const level: ApprovalLevel | null = status === "PENDING_MANAGER" ? "MANAGER" : status === "PENDING_AUDITOR" ? "AUDITOR" : status === "PENDING_HEAD" ? "HEAD" : null
    const c: Claim = {
      id, claimNumber: claimNumber(id), employeeId: empId, employeeName: emp.name, departmentName: emp.departmentName, title, status,
      totalAmount: 0, currentLevel: level, sampleAudit: "NONE", submittedAt: status === "DRAFT" ? null : hoursAgo(ageH),
      finalDecisionAt: ["APPROVED", "PAID", "REJECTED", "IN_PAYOUT"].includes(status) ? hoursAgo(ageH - 4) : null,
      paidAt: status === "PAID" ? hoursAgo(ageH - 20) : null, payoutBatchId: null, version: status === "DRAFT" ? 0 : 1,
      createdAt: hoursAgo(ageH + 1), updatedAt: hoursAgo(ageH), lines: evaluated, approvalSteps: [], ...extra,
    }
    recalc(c)
    db.claims.push(c)
    // Seed the approval history implied by the status (R9 chain)
    const reached = ["PENDING_AUDITOR", "PENDING_HEAD", "APPROVED", "IN_PAYOUT", "PAID"].includes(status) && c.totalAmount > 5000
    if (reached) {
      const mgr = userById(emp.managerId ?? 1)
      const chain: [ApprovalLevel, User][] = [["MANAGER", mgr]]
      if (c.totalAmount > 25000 && status !== "PENDING_AUDITOR") chain.push(["AUDITOR", userById(5)])
      if (c.totalAmount > 100000 && status !== "PENDING_HEAD") chain.push(["HEAD", userById(1)])
      let from: ClaimStatus = "PENDING_MANAGER"
      chain.forEach(([level, who], k) => {
        const at = hoursAgo(ageH - (k + 1) * 3)
        const to: ClaimStatus = k < chain.length - 1 ? (chain[k + 1][0] === "AUDITOR" ? "PENDING_AUDITOR" : "PENDING_HEAD") : status === "PENDING_AUDITOR" || status === "PENDING_HEAD" ? status : "APPROVED"
        c.approvalSteps.push({ id: nextId(), level, approverId: who.id, approverName: who.name, actedById: who.id, actedByName: who.name, decision: "APPROVED", comment: null, decidedAt: at })
        db.audit.push({ id: nextId(), actorId: who.id, actorName: who.name, onBehalfOfId: null, onBehalfOfName: null, action: "CLAIM_APPROVED", entityType: "CLAIM", entityId: id, claimId: id, fromStatus: from, toStatus: to, details: { level }, correlationId: "seed", createdAt: at })
        from = to
      })
    }
    const sys = emp
    db.audit.push({ id: nextId(), actorId: empId, actorName: emp.name, onBehalfOfId: null, onBehalfOfName: null, action: "CLAIM_CREATED", entityType: "CLAIM", entityId: id, claimId: id, fromStatus: null, toStatus: "DRAFT", details: { lines: lines.length }, correlationId: "seed", createdAt: hoursAgo(ageH + 1) })
    if (status !== "DRAFT") {
      const first: ClaimStatus = ["PENDING_AUDITOR", "PENDING_HEAD", "APPROVED", "IN_PAYOUT", "PAID", "NEEDS_CLARIFICATION"].includes(status) && c.totalAmount > 5000 ? "PENDING_MANAGER" : status
      db.audit.push({ id: nextId(), actorId: sys.id, actorName: sys.name, onBehalfOfId: null, onBehalfOfName: null, action: "CLAIM_SUBMITTED", entityType: "CLAIM", entityId: id, claimId: id, fromStatus: "DRAFT", toStatus: first, details: { flags: flagsOf(c), total: c.totalAmount }, correlationId: "seed", createdAt: hoursAgo(ageH) })
    }
    return c
  }

  // Demo employee (Asha) — a spread of statuses
  mk(101, "Team lunch Pune", "PAID", 600, [["MEALS", 26, 1350, "Barbeque Nation", "Pune"]])
  mk(101, "Hyderabad partner workshop", "APPROVED", 200, [["TRAIN", 10, 2450, "IRCTC", "Hyderabad"], ["MEALS", 10, 980, "Paradise Biryani", "Hyderabad"]])
  const nc = mk(101, "Chennai data-centre visit", "NEEDS_CLARIFICATION", 30, [["HOTEL", 6, 13800, "Taj Coromandel", "Chennai", 2], ["LOCAL_CAB", 6, 640, "Uber", "Chennai"]], { currentLevel: null })
  nc.approvalSteps.push({ id: nextId(), level: "MANAGER", approverId: 21, approverName: "Vikram Nair", actedById: 21, actedByName: "Vikram Nair", decision: "SENT_BACK", comment: "Please attach the hotel invoice with GST details.", decidedAt: hoursAgo(26) })
  audit(userById(21), "CLAIM_SENT_BACK", nc, "PENDING_MANAGER", "NEEDS_CLARIFICATION", { comment: "Please attach the hotel invoice with GST details." })
  db.audit[db.audit.length - 1].createdAt = hoursAgo(26)
  mk(101, "Delhi offsite supplies", "DRAFT", 3, [["OTHER", 2, 1850, "Staples", "Delhi"]])
  mk(101, "Client dinner Bengaluru", "PENDING_MANAGER", 18, [["MEALS", 4, 2600, "Toit", "Bengaluru"], ["LOCAL_CAB", 4, 420, "Ola", "Bengaluru"]])

  // Colleague (blocked demo)
  mk(102, "Kolkata vendor meeting", "PENDING_MANAGER", 52, [["FLIGHT", 8, 7400, "Air India", "Kolkata"], ["HOTEL", 8, 5200, "The Park", "Kolkata", 1]])
  // Priya, Rohan, Karan — manager / auditor / head queues
  mk(133, "Brand shoot props", "PENDING_MANAGER", 74.5, [["OTHER", 5, 8200, "Prop House", "Mumbai"], ["LOCAL_CAB", 5, 2350, "Uber", "Mumbai"]])
  mk(117, "Bengaluru sales conference", "PENDING_AUDITOR", 20.4, [["FLIGHT", 12, 18400, "IndiGo", "Bengaluru"], ["HOTEL", 12, 26550, "ITC Gardenia", "Bengaluru", 3], ["MEALS", 11, 3300, "Truffles", "Bengaluru"]])
  mk(129, "Delhi vendor audit", "PENDING_AUDITOR", 31, [["HOTEL", 9, 21000, "Le Meridien", "Delhi", 3], ["FLIGHT", 9, 9800, "Vistara", "Delhi"]])
  mk(133, "Goa marketing summit", "PENDING_HEAD", 46, [["HOTEL", 14, 145000, "Beach Resort Goa", "Goa", 2], ["FLIGHT", 15, 14200, "IndiGo", "Goa"]])
  mk(117, "Ahmedabad dealer visit", "APPROVED", 90, [["TRAIN", 20, 1900, "IRCTC", "Ahmedabad"], ["HOTEL", 20, 9800, "Hyatt", "Ahmedabad", 2]])
  mk(129, "Warehouse audit Pune", "APPROVED", 120, [["LOCAL_CAB", 25, 1600, "Meru", "Pune"], ["MEALS", 25, 1100, "Vaishali", "Pune"]], { sampleAudit: "OPEN" })
  mk(133, "Product launch travel", "APPROVED", 70, [["FLIGHT", 16, 12600, "Akasa Air", "Delhi"], ["HOTEL", 16, 11000, "Taj Palace", "Delhi", 2]])
  mk(102, "Conference pass", "REJECTED", 300, [["OTHER", 40, 4800, "Nasscom"]])

  db.comments.push({ id: nextId(), claimId: nc.id, authorId: 21, authorName: "Vikram Nair", authorRole: "MANAGER", body: "Please attach the hotel invoice with GST details.", createdAt: hoursAgo(26) })
  persist()
  return db
}

// ---------------------------------------------------------------- receipt art
function receiptSvg(r: ReceiptUpload | undefined, claim?: Claim, line?: ClaimLine) {
  const vendor = line?.vendor ?? r?.fileName ?? "Receipt"
  const amt = line ? line.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—"
  const rows = [
    ["Date", line?.expenseDate ?? ""],
    ["City", line?.city ?? ""],
    ["Category", line?.category ?? ""],
    ["Ref", claim?.claimNumber ?? ""],
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520">
  <rect width="360" height="520" fill="#fbfaf6"/>
  <text x="180" y="64" font-family="Courier New, monospace" font-size="20" font-weight="700" text-anchor="middle" fill="#222">${vendor.toUpperCase()}</text>
  <text x="180" y="88" font-family="Courier New, monospace" font-size="12" text-anchor="middle" fill="#666">TAX INVOICE · GSTIN 27AABCU9603R1ZM</text>
  <line x1="28" y1="112" x2="332" y2="112" stroke="#bbb" stroke-dasharray="4 4"/>
  ${rows.map(([k, v], i) => `<text x="28" y="${146 + i * 28}" font-family="Courier New, monospace" font-size="14" fill="#555">${k}</text><text x="332" y="${146 + i * 28}" font-family="Courier New, monospace" font-size="14" text-anchor="end" fill="#222">${v}</text>`).join("")}
  <line x1="28" y1="270" x2="332" y2="270" stroke="#bbb" stroke-dasharray="4 4"/>
  <text x="28" y="310" font-family="Courier New, monospace" font-size="16" font-weight="700" fill="#222">TOTAL INR</text>
  <text x="332" y="310" font-family="Courier New, monospace" font-size="16" font-weight="700" text-anchor="end" fill="#222">${amt}</text>
  <text x="180" y="460" font-family="Courier New, monospace" font-size="12" text-anchor="middle" fill="#888">THANK YOU · VISIT AGAIN</text>
  </svg>`
}

// ---------------------------------------------------------------- router
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": status >= 400 ? "application/problem+json" : "application/json", "X-Request-ID": Math.random().toString(16).slice(2, 18), ...headers } })
const problem = (status: number, title: string, detail: string, instance: string, errors: ProblemDetail["errors"] = []) =>
  json(status, { type: `https://expenseflow.test/problems/${title.toLowerCase().replace(/\s+/g, "-")}`, title, status, detail, instance, correlationId: Math.random().toString(16).slice(2, 18), errors })

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function validateLines(lines: ClaimLineInput[] | undefined, path: string) {
  const errors: { field: string; message: string }[] = []
  if (!lines?.length) errors.push({ field: "lines", message: "at least one line is required" })
  lines?.forEach((l, i) => {
    if (!(l.amount > 0)) errors.push({ field: `lines[${i}].amount`, message: "must be greater than 0" })
    if (!l.vendor?.trim()) errors.push({ field: `lines[${i}].vendor`, message: "must not be blank" })
    if (l.category === "HOTEL" && (!l.city || !l.nights)) errors.push({ field: `lines[${i}].city`, message: "city and nights are required for HOTEL" })
  })
  return errors.length ? problem(400, "Validation failed", `${errors.length} field${errors.length > 1 ? "s are" : " is"} invalid`, path, errors) : null
}

export async function mockFetch(url: string, init: RequestInit): Promise<Response> {
  await wait(220 + Math.random() * 260)
  const u = new URL(url, location.origin)
  const path = u.pathname
  const method = (init.method ?? "GET").toUpperCase()
  const headers = new Headers(init.headers)
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body
  const q = u.searchParams

  if (path === "/api/auth/login" && method === "POST") {
    const user = USERS.find((x) => x.email === body?.email?.trim().toLowerCase())
    if (!user || user.password !== body?.password) return problem(401, "Unauthorized", "Email or password is incorrect", path)
    const { password: _pw, ...pub } = user
    void _pw
    return json(200, { token: `mock.${user.id}.${Date.now()}`, tokenType: "Bearer", expiresInSeconds: 3600, user: pub })
  }

  const token = headers.get("Authorization")?.replace("Bearer ", "")
  const me = token?.startsWith("mock.") ? USERS.find((x) => x.id === Number(token.split(".")[1])) : undefined
  if (!me) return problem(401, "Unauthorized", "Missing or expired token", path)
  const role = me.role

  const idemKey = headers.get("Idempotency-Key")
  const idem = (fn: () => Response | Promise<Response>) => async () => {
    const k = idemKey ? `${me.id}:${path}:${idemKey}` : null
    if (k && db.idem[k]) {
      const s = db.idem[k] as { status: number; body: unknown }
      return json(s.status, s.body)
    }
    if (k && inflight.has(k)) return (await inflight.get(k)!).clone()
    const p = Promise.resolve(fn())
    if (k) inflight.set(k, p)
    const res = await p
    if (k) inflight.delete(k)
    if (k && res.ok) db.idem[k] = { status: res.status, body: await res.clone().json() }
    persist()
    return res.clone()
  }

  const m = path.match(/^\/api\/claims\/(\d+)(?:\/([a-z-]+))?$/)
  const claim = m ? db.claims.find((c) => c.id === Number(m[1])) : undefined
  const sub = m?.[2]

  // ---- auth / me
  if (path === "/api/me") return json(200, { ...me, password: undefined })

  // ---- claims collection
  if (path === "/api/claims" && method === "GET") {
    const status = q.get("status")
    const list = db.claims.filter((c) => c.employeeId === me.id && (!status || c.status === status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return json(200, page(list.map(summary)))
  }
  if (path === "/api/claims" && method === "POST") {
    return idem(() => {
      const bad = validateLines(body.lines, path)
      if (bad) return bad
      if (!body.title?.trim()) return problem(400, "Validation failed", "1 field is invalid", path, [{ field: "title", message: "must not be blank" }])
      const id = 200 + db.claims.length
      const c: Claim = { id, claimNumber: claimNumber(id), employeeId: me.id, employeeName: me.name, departmentName: me.departmentName, title: body.title, status: "DRAFT", totalAmount: 0, currentLevel: null, sampleAudit: "NONE", submittedAt: null, finalDecisionAt: null, paidAt: null, payoutBatchId: null, version: 0, createdAt: now(), updatedAt: now(), lines: draftLines(body.lines), approvalSteps: [] }
      recalc(c)
      db.claims.push(c)
      audit(me, "CLAIM_CREATED", c, null, "DRAFT", { lines: c.lines.length })
      return json(201, c)
    })()
  }

  // ---- single claim
  if (m) {
    if (!claim || !canView(me, claim)) return problem(404, "Not found", "Claim not found", path)
    const own = claim.employeeId === me.id

    if (!sub && method === "GET") return json(200, claim)
    if (!sub && method === "PUT") {
      if (!own) return problem(403, "Forbidden", "Only the owner can edit a claim", path)
      if (!["DRAFT", "NEEDS_CLARIFICATION"].includes(claim.status)) return problem(409, "Invalid status transition", `Claim is ${claim.status} and can't be edited`, path)
      if (body.version !== claim.version) return problem(409, "Stale version", "Someone else changed this claim. Reload and try again.", path)
      const bad = validateLines(body.lines, path)
      if (bad) return bad
      claim.title = body.title
      claim.lines = draftLines(body.lines)
      claim.version++
      claim.updatedAt = now()
      recalc(claim)
      audit(me, "CLAIM_UPDATED", claim, claim.status, claim.status, { lines: claim.lines.length })
      persist()
      return json(200, claim)
    }
    if (sub === "submit" && method === "POST") {
      return idem(() => {
        if (!own) return problem(403, "Forbidden", "Only the owner can submit a claim", path)
        if (!["DRAFT", "NEEDS_CLARIFICATION"].includes(claim.status)) return problem(409, "Invalid status transition", `Action submit is not allowed in status ${claim.status}`, path)
        const from = claim.status
        claim.lines = evaluate(claim.lines, me.id, claim.id)
        const lines = claim.lines
        let to: ClaimStatus
        if (lines.some((l) => l.outcome === "AUTO_REJECT")) to = "REJECTED"
        else if (lines.every((l) => l.outcome === "AUTO_APPROVE") && claim.totalAmount <= 5000) to = "APPROVED"
        else to = "PENDING_MANAGER"
        claim.status = to
        claim.currentLevel = to === "PENDING_MANAGER" ? "MANAGER" : null
        claim.submittedAt = now()
        claim.updatedAt = now()
        claim.version++
        if (to === "APPROVED") {
          claim.finalDecisionAt = now()
          if (Math.random() < 0.1) claim.sampleAudit = "OPEN"
        }
        if (to === "REJECTED") claim.finalDecisionAt = now()
        audit(me, "CLAIM_SUBMITTED", claim, from, to, { flags: flagsOf(claim), total: claim.totalAmount })
        return json(200, claim)
      })()
    }
    if (["approve", "send-back", "reject"].includes(sub ?? "") && method === "POST") {
      const level = claim.currentLevel
      if (!level || !claim.status.startsWith("PENDING_")) return problem(409, "Invalid status transition", `Action ${sub} is not allowed in status ${claim.status}`, path)
      if (own) return problem(403, "Forbidden", "You can't act on your own claim", path)
      let onBehalf: User | undefined
      if (level === "MANAGER") {
        const owner = userById(claim.employeeId)
        if (owner.managerId !== me.id) {
          if (activeDelegatorsOf(me.id).includes(owner.managerId ?? -1)) onBehalf = userById(owner.managerId!)
          else return problem(403, "Forbidden", "You are not the approver for this claim", path)
        }
      } else if (level !== role) return problem(403, "Forbidden", `Only a ${level.toLowerCase()} can act at this level`, path)
      const from = claim.status
      const comment: string | null = body?.comment ?? body?.reason ?? null
      if (sub !== "approve" && !comment?.trim()) return problem(400, "Validation failed", "A comment is required", path, [{ field: sub === "reject" ? "reason" : "comment", message: "must not be blank" }])
      let to: ClaimStatus
      if (sub === "approve") {
        if (level === "MANAGER") to = claim.totalAmount > 25000 ? "PENDING_AUDITOR" : "APPROVED"
        else if (level === "AUDITOR") to = claim.totalAmount > 100000 ? "PENDING_HEAD" : "APPROVED"
        else to = "APPROVED"
      } else to = sub === "reject" ? "REJECTED" : "NEEDS_CLARIFICATION"
      claim.approvalSteps.push({ id: nextId(), level, approverId: onBehalf?.id ?? me.id, approverName: onBehalf?.name ?? me.name, actedById: me.id, actedByName: me.name, decision: sub === "approve" ? "APPROVED" : sub === "reject" ? "REJECTED" : "SENT_BACK", comment, decidedAt: now() })
      claim.status = to
      claim.currentLevel = to === "PENDING_AUDITOR" ? "AUDITOR" : to === "PENDING_HEAD" ? "HEAD" : null
      claim.updatedAt = now()
      claim.version++
      if (to === "APPROVED" || to === "REJECTED") claim.finalDecisionAt = now()
      audit(me, sub === "approve" ? "CLAIM_APPROVED" : sub === "reject" ? "CLAIM_REJECTED" : "CLAIM_SENT_BACK", claim, from, to, { level, comment, delegated: !!onBehalf }, onBehalf)
      if (comment && sub !== "approve") db.comments.push({ id: nextId(), claimId: claim.id, authorId: me.id, authorName: me.name, authorRole: role, body: comment, createdAt: now() })
      persist()
      return json(200, claim)
    }
    if (sub === "sample-audit" && method === "POST") {
      if (role !== "AUDITOR") return problem(403, "Forbidden", "Only auditors resolve sample audits", path)
      if (claim.sampleAudit !== "OPEN") return problem(409, "Invalid status transition", "No open sample audit on this claim", path)
      const from = claim.status
      claim.sampleAudit = body.result
      if (body.result === "FAILED") claim.status = "REJECTED"
      claim.updatedAt = now()
      audit(me, body.result === "FAILED" ? "SAMPLE_AUDIT_FAILED" : "SAMPLE_AUDIT_CLEARED", claim, from, claim.status, { reason: body.reason })
      persist()
      return json(200, claim)
    }
    if (sub === "comments" && method === "GET") return json(200, db.comments.filter((c) => c.claimId === claim.id))
    if (sub === "comments" && method === "POST") {
      if (!body?.body?.trim()) return problem(400, "Validation failed", "Comment can't be empty", path)
      const c: Comment = { id: nextId(), claimId: claim.id, authorId: me.id, authorName: me.name, authorRole: role, body: body.body.trim(), createdAt: now() }
      db.comments.push(c)
      audit(me, "COMMENT_ADDED", claim, null, null, { commentId: c.id })
      persist()
      return json(201, c)
    }
    if (sub === "audit" && method === "GET") return json(200, db.audit.filter((a) => a.claimId === claim.id))
  }

  // ---- receipts
  if (path === "/api/receipts" && method === "POST") {
    const file = (init.body as FormData).get("file") as File
    if (!file) return problem(400, "Validation failed", "file is required", path)
    if (file.size > 5 * 1024 * 1024) return problem(413, "File too large", "Max 5 MB", path)
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type)) return problem(415, "Unsupported file type", "Only JPEG, PNG or PDF", path)
    const hashBuf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
    const sha256 = [...new Uint8Array(hashBuf)].map((b) => b.toString(16).padStart(2, "0")).join("")
    const dup = db.receipts.find((r) => r.sha256 === sha256)
    const r: ReceiptUpload = { id: nextId(), fileName: file.name, contentType: file.type as ReceiptUpload["contentType"], sizeBytes: file.size, sha256, duplicateOfReceiptId: dup?.id ?? null, uploadedAt: now() }
    db.receipts.push(r)
    blobs.set(r.id, file)
    persist()
    return json(201, r)
  }
  const rm = path.match(/^\/api\/receipts\/(\d+)\/content$/)
  if (rm) {
    const id = Number(rm[1])
    const owner = db.claims.find((c) => c.lines.some((l) => l.receiptId === id))
    if (owner && !canView(me, owner)) return problem(404, "Not found", "Receipt not found", path)
    const blob = blobs.get(id)
    if (blob) return new Response(blob, { status: 200, headers: { "Content-Type": blob.type } })
    const r = db.receipts.find((x) => x.id === id)
    const line = owner?.lines.find((l) => l.receiptId === id)
    return new Response(receiptSvg(r, owner, line), { status: 200, headers: { "Content-Type": "image/svg+xml" } })
  }

  // ---- approvals
  if (path === "/api/approvals/queue") {
    if (role === "EMPLOYEE") return problem(403, "Forbidden", "Approvers only", path)
    let list: Claim[]
    if (role === "MANAGER") {
      const bosses = [me.id, ...activeDelegatorsOf(me.id)]
      list = db.claims.filter((c) => c.status === "PENDING_MANAGER" && bosses.includes(userById(c.employeeId).managerId ?? -1) && c.employeeId !== me.id)
    } else if (role === "AUDITOR") list = db.claims.filter((c) => c.status === "PENDING_AUDITOR" || (c.status === "APPROVED" && c.sampleAudit === "OPEN"))
    else list = db.claims.filter((c) => c.status === "PENDING_HEAD")
    const f = Object.fromEntries(q.entries())
    list = list.filter((c) => {
      if (f.category && !c.lines.some((l) => l.category === f.category)) return false
      if (f.flag && !flagsOf(c).includes(f.flag as Flag)) return false
      if (f.status && c.status !== f.status) return false
      if (f.minAmount && c.totalAmount < Number(f.minAmount)) return false
      if (f.maxAmount && c.totalAmount > Number(f.maxAmount)) return false
      if (f.departmentId && userById(c.employeeId).departmentId !== Number(f.departmentId)) return false
      if (f.sampleAuditOnly === "true" && c.sampleAudit !== "OPEN") return false
      return true
    })
    return json(200, page(list.map(summary).sort((a, b) => (b.waitingHours ?? 0) - (a.waitingHours ?? 0))))
  }
  if (path === "/api/approvals/bulk-approve" && method === "POST") {
    if (role !== "AUDITOR") return problem(403, "Forbidden", "Auditors only", path)
    return idem(() => {
      const results = (body.claimIds as number[]).map((id) => {
        const c = db.claims.find((x) => x.id === id)
        if (!c) return { claimId: id, claimNumber: null, outcome: "SKIPPED" as const, newStatus: null, errorStatus: 404, errorDetail: "Claim not found" }
        if (c.status !== "PENDING_AUDITOR") return { claimId: id, claimNumber: c.claimNumber, outcome: "SKIPPED" as const, newStatus: null, errorStatus: 409, errorDetail: `Claim is ${c.status}, not PENDING_AUDITOR` }
        if (c.employeeId === me.id) return { claimId: id, claimNumber: c.claimNumber, outcome: "SKIPPED" as const, newStatus: null, errorStatus: 403, errorDetail: "Own claim" }
        const to: ClaimStatus = c.totalAmount > 100000 ? "PENDING_HEAD" : "APPROVED"
        c.approvalSteps.push({ id: nextId(), level: "AUDITOR", approverId: me.id, approverName: me.name, actedById: me.id, actedByName: me.name, decision: "APPROVED", comment: body.comment ?? null, decidedAt: now() })
        audit(me, "CLAIM_APPROVED", c, c.status, to, { level: "AUDITOR", bulk: true })
        c.status = to
        c.currentLevel = to === "PENDING_HEAD" ? "HEAD" : null
        c.updatedAt = now()
        c.version++
        if (to === "APPROVED") c.finalDecisionAt = now()
        return { claimId: id, claimNumber: c.claimNumber, outcome: to === "APPROVED" ? ("APPROVED" as const) : ("PENDING_HEAD" as const), newStatus: to, errorStatus: null, errorDetail: null }
      })
      const failed = results.filter((r) => r.outcome === "SKIPPED").length
      return json(200, { processed: results.length, succeeded: results.length - failed, failed, results })
    })()
  }

  // ---- delegations
  if (path === "/api/delegations") {
    if (role === "EMPLOYEE") return problem(403, "Forbidden", "Approvers only", path)
    if (method === "GET") return json(200, db.delegations.filter((d) => d.approverId === me.id || d.delegateId === me.id))
    const delegate = USERS.find((x) => x.id === Number(body.delegateId))
    if (!delegate) return problem(400, "Validation failed", "Unknown delegate", path, [{ field: "delegateId", message: "no such employee" }])
    if (body.toDate < body.fromDate) return problem(400, "Validation failed", "End date is before start date", path, [{ field: "toDate", message: "must be on or after fromDate" }])
    const today = new Date().toISOString().slice(0, 10)
    const d: Delegation = { id: nextId(), approverId: me.id, approverName: me.name, delegateId: delegate.id, delegateName: delegate.name, fromDate: body.fromDate, toDate: body.toDate, active: body.fromDate <= today && today <= body.toDate, createdAt: now() }
    db.delegations.push(d)
    persist()
    return json(201, d)
  }

  // ---- payouts
  if (path.startsWith("/api/payout")) {
    if (role !== "HEAD") return problem(403, "Forbidden", "Finance head only", path)
    if (path === "/api/payout/eligible") return json(200, page(db.claims.filter((c) => c.status === "APPROVED" && c.sampleAudit !== "OPEN").map(summary)))
    if (path === "/api/payout-batches" && method === "GET") return json(200, page([...db.batches].reverse().map((b) => ({ ...b, claims: null }))))
    if (path === "/api/payout-batches" && method === "POST") {
      return idem(() => {
        const claims = db.claims.filter((c) => body.claimIds.includes(c.id) && c.status === "APPROVED" && c.sampleAudit !== "OPEN")
        if (!claims.length) return problem(409, "Invalid status transition", "None of the selected claims are eligible", path)
        const n = db.batches.length + 1
        const d = new Date().toISOString().slice(0, 10).replace(/-/g, "")
        const b: PayoutBatch = { id: nextId(), batchRef: `PB-${d}-${String(n).padStart(3, "0")}`, status: "PENDING_SEND", claimCount: claims.length, totalAmount: round2(claims.reduce((s, c) => s + c.totalAmount, 0)), fileName: `PAYOUT_PB-${d}-${String(n).padStart(3, "0")}_${d}.csv`, attempts: 1, lastError: "Bank timeout after 3000 ms", bankReference: null, createdById: me.id, createdByName: me.name, createdAt: now(), sentAt: null, claims: null }
        for (const c of claims) {
          audit(me, "PAYOUT_BATCH_CREATED", c, c.status, "IN_PAYOUT", { batchRef: b.batchRef })
          c.status = "IN_PAYOUT"
          c.payoutBatchId = b.id
          c.updatedAt = now()
        }
        db.batches.push(b)
        // The "30 s retry job": the mock bank comes back after ~12 s.
        setTimeout(() => sendBatch(b.id, me), 12_000)
        return json(201, { ...b, claims: claims.map(summary) })
      })()
    }
    const bm = path.match(/^\/api\/payout-batches\/(\d+)(?:\/(file|retry))?$/)
    const batch = bm ? db.batches.find((b) => b.id === Number(bm[1])) : undefined
    if (bm && !batch) return problem(404, "Not found", "Batch not found", path)
    if (batch && !bm![2]) return json(200, { ...batch, claims: db.claims.filter((c) => c.payoutBatchId === batch.id).map(summary) })
    if (batch && bm![2] === "retry") {
      if (batch.status === "SENT") return json(200, batch)
      sendBatch(batch.id, me)
      return json(200, db.batches.find((b) => b.id === batch.id))
    }
    if (batch && bm![2] === "file") {
      const rows = db.claims.filter((c) => c.payoutBatchId === batch.id).map((c) => {
        const e = userById(c.employeeId)
        return `${batch.batchRef},${c.claimNumber},${e.employeeCode},${e.name},1234567890${String(e.id).padStart(2, "0")},HDFC0001234,${c.totalAmount.toFixed(2)},${c.claimNumber} reimbursement`
      })
      const csv = ["batch_ref,claim_number,employee_code,employee_name,account_number,ifsc,amount_inr,narration", ...rows].join("\n") + "\n"
      return new Response(csv, { status: 200, headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${batch.fileName}"` } })
    }
  }

  // ---- dashboard
  if (path === "/api/dashboard/summary") {
    if (role !== "AUDITOR" && role !== "HEAD") return problem(403, "Forbidden", "Auditor or head only", path)
    const pending = db.claims.filter((c) => c.status.startsWith("PENDING_")).map(summary).sort((a, b) => (b.waitingHours ?? 0) - (a.waitingHours ?? 0))
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - (11 - i))
      const base = [1210, 1340, 1280, 1460, 1390, 1520, 1610, 1570, 1720, 1680, 1650, 1483][i]
      return { month: d.toISOString().slice(0, 7), amount: base * 1000 + 300 }
    })
    return json(200, {
      from: q.get("from") ?? daysAgoDate(365),
      to: q.get("to") ?? daysAgoDate(0),
      kpis: {
        pendingByLevel: { MANAGER: 24 + pending.filter((p) => p.currentLevel === "MANAGER").length, AUDITOR: 11 + pending.filter((p) => p.currentLevel === "AUDITOR").length, HEAD: 3 + pending.filter((p) => p.currentLevel === "HEAD").length },
        oldestPendingHours: Math.max(74.5, ...pending.map((p) => p.waitingHours ?? 0)),
        policyViolations: 612,
        avgApprovalHours: 18.6,
        totalPaid: 18452300 + db.claims.filter((c) => c.status === "PAID").reduce((s, c) => s + c.totalAmount, 0),
      },
      spendByCategory: [
        { category: "HOTEL", amount: 7215400 },
        { category: "FLIGHT", amount: 5893100 },
        { category: "MEALS", amount: 2104500 },
        { category: "LOCAL_CAB", amount: 1388200 },
        { category: "TRAIN", amount: 902300 },
        { category: "OTHER", amount: 948800 },
      ],
      spendByDepartment: [
        { departmentId: 2, departmentName: "Sales", amount: 5120400 },
        { departmentId: 1, departmentName: "Engineering", amount: 3987600 },
        { departmentId: 3, departmentName: "Operations", amount: 3104200 },
        { departmentId: 4, departmentName: "Marketing", amount: 2766900 },
        { departmentId: 5, departmentName: "Customer Success", amount: 1802300 },
        { departmentId: 9, departmentName: "Finance", amount: 891100 },
      ],
      spendByMonth: months,
      violationsByFlag: [
        { flag: "WEEKEND", count: 298 },
        { flag: "OVER_LIMIT", count: 241 },
        { flag: "DUPLICATE", count: 52 },
        { flag: "MISSING_RECEIPT", count: 21 },
      ],
      exceptions: pending.slice(0, 10),
    })
  }

  if (path === "/api/policy-rules") {
    const cfg: PolicyConfig = {
      rules: [
        { id: 1, code: "MEAL_DAILY", category: "MEALS", limitAmount: 1500, unit: "PER_DAY", cityTier: null, active: true, description: "Meals up to 1,500 INR per employee per day" },
        { id: 2, code: "HOTEL_T1", category: "HOTEL", limitAmount: 6000, unit: "PER_NIGHT", cityTier: 1, active: true, description: "Hotel up to 6,000 INR per night in tier-1 cities" },
        { id: 3, code: "HOTEL_OTHER", category: "HOTEL", limitAmount: 4000, unit: "PER_NIGHT", cityTier: 2, active: true, description: "Hotel up to 4,000 INR per night in other cities" },
        { id: 4, code: "CAB_TRIP", category: "LOCAL_CAB", limitAmount: 2000, unit: "PER_TRIP", cityTier: null, active: true, description: "Local cab up to 2,000 INR per trip" },
      ],
      settings: [
        { key: "receipt.required.above", value: "500", description: "Receipt mandatory above this amount" },
        { key: "auto_approve.max_total", value: "5000", description: "Max claim total for auto-approval" },
        { key: "approval.auditor.above", value: "25000", description: "Auditor step above this total" },
        { key: "approval.head.above", value: "100000", description: "Head step above this total" },
        { key: "sample_audit.rate", value: "0.10", description: "Share of auto-approved claims sampled" },
        { key: "alert.oldest_pending.hours", value: "48", description: "Alert threshold for oldest pending approval" },
      ],
      tier1Cities: TIER1,
    }
    return json(200, cfg)
  }

  return problem(404, "Not found", `No mock for ${method} ${path}`, path)
}

function sendBatch(id: number, actor: User) {
  const b = db.batches.find((x) => x.id === id)
  if (!b || b.status === "SENT") return
  b.attempts++
  b.status = "SENT"
  b.lastError = null
  b.bankReference = "BNK-" + Math.random().toString(36).slice(2, 8).toUpperCase()
  b.sentAt = now()
  for (const c of db.claims.filter((x) => x.payoutBatchId === id)) {
    audit(actor, "CLAIM_PAID", c, c.status, "PAID", { bankReference: b.bankReference })
    c.status = "PAID"
    c.paidAt = now()
    c.updatedAt = now()
  }
  persist()
}

/** Dev helper: wipe and reseed the mock database. */
export function resetMockDb() {
  sessionStorage.removeItem(STORE_KEY)
  db = seed()
}

// Initialise last so every helper above is defined before seeding.
db = load()
