/** Screen-level tests for pages and branches not covered in pages.test.tsx. */
import { describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import { renderApp, renderAt, signIn } from "@/test/render"
import { Api } from "@/api/endpoints"
import { newIdempotencyKey } from "@/api/client"
import { localDaysAgo } from "@/lib/claim-rules"
import DashboardPage from "./DashboardPage"
import PayoutsPage from "./PayoutsPage"
import DelegationPage from "./DelegationPage"
import ClaimDetailPage from "./ClaimDetailPage"
import ClaimFormPage from "./ClaimFormPage"
import ClaimsPage from "./ClaimsPage"
import LoginPage from "./LoginPage"
import ApprovalsPage from "./ApprovalsPage"

const weekday = (() => {
  for (let i = 1; i < 8; i++) {
    const d = localDaysAgo(i)
    const day = new Date(d + "T00:00:00").getDay()
    if (day !== 0 && day !== 6) return d
  }
  return localDaysAgo(1)
})()

describe("App routing & guards (ST-01)", () => {
  it("signed-out users are sent to /login", async () => {
    await renderApp("/payouts")
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument()
  })

  it("a signed-in user visiting /login goes to their home", async () => {
    await signIn("mgr.demo@expenseflow.test")
    await renderApp("/login")
    expect(await screen.findByRole("heading", { level: 1, name: "Approvals" })).toBeInTheDocument()
  })

  it("role guard: employee opening /dashboard lands on My claims", async () => {
    await signIn()
    await renderApp("/dashboard")
    expect(await screen.findByRole("heading", { level: 1, name: "My claims" })).toBeInTheDocument()
  })

  it("unknown routes show the 404 page inside the shell", async () => {
    await signIn()
    await renderApp("/nope")
    expect(await screen.findByText("This page doesn't exist")).toBeInTheDocument()
  })

  it("the shell shows the user, role-specific nav, a queue count and signs out", async () => {
    await signIn("auditor.demo@expenseflow.test")
    const { user } = await renderApp("/approvals")
    const nav = await screen.findByRole("navigation", { name: "Main" })
    expect(within(nav).getByRole("link", { name: /Dashboard/ })).toBeInTheDocument()
    expect(within(nav).queryByRole("link", { name: /Payouts/ })).toBeNull()
    await waitFor(() => expect(within(nav).getByRole("link", { name: /Approvals/ })).toHaveTextContent(/\d/))
    expect(screen.getByText("Kavya Reddy")).toBeInTheDocument()
    await user.click(screen.getByTestId("logout"))
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument()
  })
})

describe("Approval queue (ST-07)", () => {
  const queue = () => renderAt("/approvals", [{ path: "/approvals", element: <ApprovalsPage /> }, { path: "/approvals/:id", element: <div data-testid="approver-view" /> }])

  it("filter panel narrows by category / amount and Clear all resets", async () => {
    await signIn("auditor.demo@expenseflow.test")
    const { user } = queue()
    await screen.findAllByText("Bengaluru sales conference")
    await user.click(screen.getByTestId("toggle-filters"))
    await user.selectOptions(screen.getByTestId("filter-category"), "MEALS")
    await waitFor(() => expect(screen.queryAllByText("Delhi vendor audit")).toHaveLength(0))
    expect(screen.getAllByText("Bengaluru sales conference").length).toBeGreaterThan(0)
    await user.type(screen.getByTestId("filter-min"), "999999")
    expect(await screen.findByText("No claims match these filters")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /Clear all/ }))
    expect((await screen.findAllByText("Delhi vendor audit")).length).toBeGreaterThan(0)
  })

  it("sample-audit pill shows only sample audits", async () => {
    await signIn("auditor.demo@expenseflow.test")
    const { user } = queue()
    await screen.findAllByText("Delhi vendor audit")
    await user.click(screen.getByRole("button", { name: "Sample audits" }))
    await waitFor(() => expect(screen.queryAllByText("Delhi vendor audit")).toHaveLength(0))
    expect(screen.getAllByText("Warehouse audit Pune").length).toBeGreaterThan(0)
  })

  it("bulk approve shows per-claim results, then clears the selection", async () => {
    await signIn("auditor.demo@expenseflow.test")
    const { user } = queue()
    await user.click(await screen.findByTestId("select-all"))
    await user.click(screen.getByTestId("bulk-approve"))
    await user.click(await screen.findByTestId("confirm-bulk"))
    const dlg = await screen.findByRole("dialog", { name: "Bulk approve results" })
    expect(within(dlg).getByText(/2 processed · 2 succeeded · 0 skipped/)).toBeInTheDocument()
    await user.click(within(dlg).getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull())
  })

  it("clicking a row opens the approver view; waiting time over 48h is highlighted", async () => {
    await signIn("mgr.demo@expenseflow.test")
    const { user } = queue()
    expect(await screen.findByText("Over the 48h alert threshold")).toBeInTheDocument()
    await user.click(screen.getAllByRole("link", { name: /Brand shoot props/ })[0])
    expect(await screen.findByTestId("approver-view")).toBeInTheDocument()
  })
})

describe("Dashboard (ST-10)", () => {
  it("renders KPIs, breakdowns and the oldest-pending list", async () => {
    await signIn("head.demo@expenseflow.test")
    const { user } = renderAt("/dashboard", [{ path: "/dashboard", element: <DashboardPage /> }])
    expect(await screen.findByText("Pending approvals")).toBeInTheDocument()
    expect(screen.getAllByText("Oldest pending").length).toBe(2) // KPI + list header
    for (const t of ["Policy violations", "Avg approval time", "Approval queues", "Category breakdown", "Spend by department", "Violations by flag"]) expect(screen.getByText(t)).toBeInTheDocument()
    expect(screen.getByText("Above 48h alert")).toBeInTheDocument()
    expect(screen.getByText("Hotel")).toBeInTheDocument()
    expect(screen.getAllByRole("link", { name: /Brand shoot props/ }).length).toBeGreaterThan(0)
    await user.click(screen.getByRole("tab", { name: "3 months" }))
    expect(screen.getByRole("tab", { name: "3 months" })).toHaveAttribute("aria-selected", "true")
  })

  it("shows an error state with retry when the API refuses", async () => {
    await signIn("mgr.demo@expenseflow.test") // managers get 403 from the dashboard API
    renderAt("/dashboard", [{ path: "/dashboard", element: <DashboardPage /> }])
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden")
  })
})

describe("Payouts (ST-09)", () => {
  it("creates a batch from selected claims, shows Waiting for bank, then Sent after retry", async () => {
    await signIn("head.demo@expenseflow.test")
    const { user } = renderAt("/payouts", [{ path: "/payouts", element: <PayoutsPage /> }])
    await user.click(await screen.findByTestId("payout-select-all"))
    await user.click(screen.getByTestId("create-batch"))
    await user.click(await screen.findByTestId("confirm-batch"))
    const batch = await screen.findByTestId(/^batch-/)
    expect(within(batch).getByText("Waiting for bank")).toBeInTheDocument()
    await user.click(within(batch).getByRole("button", { name: /Retry now/ }))
    expect(await within(batch).findByText("Sent")).toBeInTheDocument()
    expect(within(batch).getByText(/BNK-/)).toBeInTheDocument()
    expect(await screen.findByText("Nothing to pay right now")).toBeInTheDocument()
  })

  it("Create batch is disabled until something is selected", async () => {
    await signIn("head.demo@expenseflow.test")
    renderAt("/payouts", [{ path: "/payouts", element: <PayoutsPage /> }])
    expect(await screen.findByTestId("create-batch")).toBeDisabled()
  })

  it("downloads the bank CSV", async () => {
    await signIn("head.demo@expenseflow.test")
    const ids = (await Api.listPayoutEligible()).content.map((c) => c.id)
    await Api.createPayoutBatch(ids, newIdempotencyKey())
    const createURL = vi.fn(() => "blob:x")
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: createURL, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const { user } = renderAt("/payouts", [{ path: "/payouts", element: <PayoutsPage /> }])
    await user.click(await screen.findByRole("button", { name: /Download CSV/ }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(createURL).toHaveBeenCalled()
    click.mockRestore()
  })
})

describe("Delegation (ST-06)", () => {
  it("lists existing delegations and validates the form", async () => {
    await signIn("mgr.demo@expenseflow.test")
    const { user } = renderAt("/delegation", [{ path: "/delegation", element: <DelegationPage /> }])
    expect(await screen.findByText("Neha Kulkarni")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
    await user.click(screen.getByTestId("create-delegation"))
    expect(await screen.findByText("Enter the delegate's employee ID")).toBeInTheDocument()
    await user.type(screen.getByTestId("delegate-id"), "34")
    await user.clear(screen.getByTestId("delegate-to"))
    await user.type(screen.getByTestId("delegate-to"), "2020-01-01")
    await user.click(screen.getByTestId("create-delegation"))
    expect(await screen.findByText("Must be on or after the start date")).toBeInTheDocument()
  })

  it("creates a delegation and shows it as scheduled", async () => {
    await signIn("mgr.demo@expenseflow.test")
    const { user } = renderAt("/delegation", [{ path: "/delegation", element: <DelegationPage /> }])
    await screen.findByText("Neha Kulkarni")
    await user.type(screen.getByTestId("delegate-id"), "34")
    await user.clear(screen.getByTestId("delegate-from"))
    await user.type(screen.getByTestId("delegate-from"), "2030-01-01")
    await user.clear(screen.getByTestId("delegate-to"))
    await user.type(screen.getByTestId("delegate-to"), "2030-01-05")
    await user.click(screen.getByTestId("create-delegation"))
    expect(await screen.findByText("Scheduled")).toBeInTheDocument()
  })
})

describe("Claim detail (ST-02, ST-11)", () => {
  const detail = (id: number) => renderAt(`/claims/${id}`, [{ path: "/claims/:id", element: <ClaimDetailPage /> }, { path: "/claims/:id/edit", element: <div data-testid="edit-page" /> }])

  it("NEEDS_CLARIFICATION: shows who sent it back and why, and links to fix", async () => {
    await signIn()
    const c = (await Api.listMyClaims()).content.find((x) => x.status === "NEEDS_CLARIFICATION")!
    const { user } = detail(c.id)
    expect(await screen.findByText(/Vikram Nair sent this back/)).toBeInTheDocument()
    expect(screen.getAllByText(/attach the hotel invoice with GST/).length).toBeGreaterThan(0)
    await user.click(screen.getByTestId("edit-claim"))
    expect(await screen.findByTestId("edit-page")).toBeInTheDocument()
  })

  it("REJECTED by policy: shows the line reason", async () => {
    await signIn()
    const c = await Api.createClaim({ title: "No receipt", lines: [{ category: "MEALS", expenseDate: weekday, amount: 900, vendor: "Cafe" }] }, newIdempotencyKey())
    await Api.submitClaim(c.id, newIdempotencyKey())
    detail(c.id)
    expect(await screen.findByText("Rejected by policy")).toBeInTheDocument()
    expect(screen.getAllByText(/Receipt required above 500/).length).toBeGreaterThan(0)
  })

  it("timeline merges audit events and comments; posting a comment adds it", async () => {
    await signIn()
    const c = (await Api.listMyClaims()).content.find((x) => x.status === "PENDING_MANAGER")!
    const { user } = detail(c.id)
    expect(await screen.findByText(/submitted for approval/)).toBeInTheDocument()
    expect(screen.getByText("Append-only")).toBeInTheDocument()
    expect(screen.getByTestId("comment-submit")).toBeDisabled()
    await user.type(screen.getByTestId("comment-input"), "Client was Acme Corp")
    await user.click(screen.getByTestId("comment-submit"))
    expect(await screen.findByText("Client was Acme Corp")).toBeInTheDocument()
  })

  it("chain tracker shows which levels a big claim will pass through", async () => {
    await signIn("head.demo@expenseflow.test")
    const id = (await Api.getApprovalQueue()).content[0].id // ₹1,59,200 Goa claim at HEAD
    renderAt(`/approvals/${id}`, [{ path: "/approvals/:id", element: <ClaimDetailPage approverView /> }])
    const steps = await screen.findByRole("list", { name: "Approval progress" })
    for (const s of ["Submitted", "Manager", "Auditor", "Finance head", "Approved", "Paid"]) expect(within(steps).getByText(s)).toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: /Receipts/i })).toBeInTheDocument()
  })

  it("auditor clears an open sample audit from the claim page", async () => {
    await signIn("auditor.demo@expenseflow.test")
    const s = (await Api.getApprovalQueue({ sampleAuditOnly: true })).content[0]
    const { user } = renderAt(`/approvals/${s.id}`, [{ path: "/approvals/:id", element: <ClaimDetailPage approverView /> }])
    await user.click(await screen.findByTestId("sample-clear"))
    await waitFor(async () => expect((await Api.getClaim(s.id)).sampleAudit).toBe("CLEARED"))
  })

  it("a claim you can't see shows Not found (R13)", async () => {
    await signIn("colleague.demo@expenseflow.test")
    const theirs = (await Api.listMyClaims()).content[0].id
    await signIn()
    detail(theirs)
    expect(await screen.findByText("Claim not found")).toBeInTheDocument()
  })
})

describe("Claim form — edit, draft, server errors", () => {
  const form = (path: string) => renderAt(path, [{ path: "/claims/new", element: <ClaimFormPage /> }, { path: "/claims/:id/edit", element: <ClaimFormPage /> }, { path: "/claims/:id", element: <div data-testid="detail" /> }])

  it("refuses to edit a claim that's already in review", async () => {
    await signIn()
    const c = (await Api.listMyClaims()).content.find((x) => x.status === "PENDING_MANAGER")!
    form(`/claims/${c.id}/edit`)
    expect(await screen.findByText("This claim can't be edited")).toBeInTheDocument()
  })

  it("loads a draft for editing with its lines and saves changes", async () => {
    await signIn()
    const d = (await Api.listMyClaims()).content.find((x) => x.status === "DRAFT")!
    const { user } = form(`/claims/${d.id}/edit`)
    expect(await screen.findByRole("heading", { name: "Edit draft" })).toBeInTheDocument()
    expect(screen.getByTestId("claim-title")).toHaveValue(d.title)
    await user.clear(screen.getByTestId("line-0-amount"))
    await user.type(screen.getByTestId("line-0-amount"), "1999")
    await user.click(screen.getByTestId("save-draft"))
    await waitFor(async () => expect((await Api.getClaim(d.id)).totalAmount).toBe(1999))
  })

  it("shows the reviewer's question when updating a sent-back claim", async () => {
    await signIn()
    const c = (await Api.listMyClaims()).content.find((x) => x.status === "NEEDS_CLARIFICATION")!
    form(`/claims/${c.id}/edit`)
    expect(await screen.findByRole("heading", { name: "Update & resubmit" })).toBeInTheDocument()
    expect(screen.getByText(/Vikram Nair asked/)).toBeInTheDocument()
  })

  it("a new draft is saved once and then updated (no duplicate drafts)", async () => {
    await signIn()
    const { user } = form("/claims/new")
    await user.type(await screen.findByTestId("claim-title"), "Twice saved")
    await user.type(screen.getByTestId("line-0-amount"), "120")
    await user.type(screen.getByTestId("line-0-vendor"), "Tea stall")
    await user.click(screen.getByTestId("save-draft"))
    await waitFor(async () => expect((await Api.listMyClaims()).content.filter((c) => c.title === "Twice saved")).toHaveLength(1))
    await user.clear(screen.getByTestId("line-0-amount"))
    await user.type(screen.getByTestId("line-0-amount"), "150")
    await user.click(screen.getByTestId("save-draft"))
    await waitFor(async () => {
      const mine = (await Api.listMyClaims()).content.filter((c) => c.title === "Twice saved")
      expect(mine).toHaveLength(1)
      expect(mine[0].totalAmount).toBe(150)
    })
  })

  it("dates in the future are blocked client-side", async () => {
    await signIn()
    const { user } = form("/claims/new")
    const date = await screen.findByTestId("line-0-date")
    await user.clear(date)
    await user.type(date, localDaysAgo(-2))
    await user.click(screen.getByTestId("submit-claim"))
    expect(await screen.findByText("Can't be in the future")).toBeInTheDocument()
  })
})

describe("My claims list", () => {
  it("search with no match shows the empty state", async () => {
    await signIn()
    const { user } = renderAt("/claims", [{ path: "/claims", element: <ClaimsPage /> }])
    await screen.findAllByText("Chennai data-centre visit")
    await user.type(screen.getByTestId("claims-search"), "zzz-nothing")
    expect(await screen.findByText("Nothing in this view")).toBeInTheDocument()
  })
  it("search matches by claim number too", async () => {
    await signIn()
    const c = (await Api.listMyClaims()).content[0]
    const { user } = renderAt("/claims", [{ path: "/claims", element: <ClaimsPage /> }])
    await screen.findAllByText(c.title)
    await user.type(screen.getByTestId("claims-search"), c.claimNumber)
    await waitFor(() => expect(screen.getAllByText(c.title).length).toBeGreaterThan(0))
    expect(screen.queryByText("Nothing in this view")).toBeNull()
  })
})

describe("Login edge cases", () => {
  it("a static mock that returns a different user triggers a warning toast", async () => {
    const { toast } = await import("sonner")
    const warn = vi.spyOn(toast, "warning").mockImplementation(() => 1)
    const real = Api.login
    Api.login = (async () => ({ ...(await real("emp.demo@expenseflow.test", "Demo@123")) })) as typeof Api.login
    const { user } = renderAt("/login", [{ path: "/login", element: <LoginPage /> }])
    await user.type(screen.getByTestId("login-email"), "head.demo@expenseflow.test")
    await user.type(screen.getByTestId("login-password"), "Demo@123")
    await user.click(screen.getByTestId("login-submit"))
    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("not head.demo@expenseflow.test"), expect.anything()))
    Api.login = real
    warn.mockRestore()
  })

  it("server unreachable shows the server's explanation", async () => {
    const { ApiError } = await import("@/api/client")
    const real = Api.login
    Api.login = (() => Promise.reject(new ApiError({ title: "Backend not reachable", status: 502, detail: "Nothing is answering at http://localhost:8080." }))) as typeof Api.login
    const { user } = renderAt("/login", [{ path: "/login", element: <LoginPage /> }])
    await user.type(screen.getByTestId("login-email"), "head.demo@expenseflow.test")
    await user.type(screen.getByTestId("login-password"), "x")
    await user.click(screen.getByTestId("login-submit"))
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing is answering at http://localhost:8080.")
    Api.login = real
  })

  it("429 shows a rate-limit message", async () => {
    const { ApiError } = await import("@/api/client")
    const real = Api.login
    Api.login = (() => Promise.reject(new ApiError({ title: "Too many requests", status: 429 }))) as typeof Api.login
    const { user } = renderAt("/login", [{ path: "/login", element: <LoginPage /> }])
    await user.type(screen.getByTestId("login-email"), "head.demo@expenseflow.test")
    await user.type(screen.getByTestId("login-password"), "x")
    await user.click(screen.getByTestId("login-submit"))
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts")
    Api.login = real
  })
})
