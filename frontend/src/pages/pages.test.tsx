import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import LoginPage from "./LoginPage"
import ClaimFormPage from "./ClaimFormPage"
import ClaimsPage from "./ClaimsPage"
import ApprovalsPage from "./ApprovalsPage"
import PolicyPage from "./PolicyPage"
import { renderAt, signIn } from "@/test/render"
import { FlagList } from "@/components/ds/domain"
import { CityCombobox } from "@/components/ds/combobox"
import { render } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { TooltipProvider } from "@/components/ds/tooltip"

describe("Login (ST-01)", () => {
  it("validates empty and malformed input before calling the API", async () => {
    const { user } = renderAt("/login", [{ path: "/login", element: <LoginPage /> }])
    await user.click(screen.getByTestId("login-submit"))
    expect(await screen.findByText("Enter your work email")).toBeInTheDocument()
    expect(screen.getByText("Enter your password")).toBeInTheDocument()
    await user.type(screen.getByTestId("login-email"), "not-an-email")
    await user.click(screen.getByTestId("login-submit"))
    expect(await screen.findByText("That doesn't look like an email")).toBeInTheDocument()
  })

  it("shows a clear error on wrong password", async () => {
    const { user } = renderAt("/login", [{ path: "/login", element: <LoginPage /> }])
    await user.type(screen.getByTestId("login-email"), "emp.demo@expenseflow.test")
    await user.type(screen.getByTestId("login-password"), "wrong")
    await user.click(screen.getByTestId("login-submit"))
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect")
  })

  it("demo account chips fill the form and sign in to the role's home", async () => {
    const { user } = renderAt("/login", [{ path: "/login", element: <LoginPage /> }])
    await user.click(screen.getByTestId("demo-employee"))
    await user.click(screen.getByTestId("login-submit"))
    expect(await screen.findByTestId("landed")).toBeInTheDocument()
  })
})

describe("Claim form (ST-02, ST-03)", () => {
  const routes = [{ path: "/claims/new", element: <ClaimFormPage /> }]

  it("blocks submit and shows field errors when required fields are empty", async () => {
    await signIn()
    const { user } = renderAt("/claims/new", routes)
    await user.click(await screen.findByTestId("submit-claim"))
    expect(await screen.findByText("Give the claim a short title")).toBeInTheDocument()
    expect(screen.getByText("Enter an amount")).toBeInTheDocument()
    expect(screen.getByText("Who did you pay?")).toBeInTheDocument()
  })

  it("hotel lines require city and nights", async () => {
    await signIn()
    const { user } = renderAt("/claims/new", routes)
    await user.click(await screen.findByTestId("line-0-cat-HOTEL"))
    await user.type(screen.getByTestId("claim-title"), "Trip")
    await user.type(screen.getByTestId("line-0-amount"), "5000")
    await user.type(screen.getByTestId("line-0-vendor"), "Taj")
    await user.click(screen.getByTestId("submit-claim"))
    expect(await screen.findByText("City is required for hotels")).toBeInTheDocument()
    expect(screen.getByText("Nights required")).toBeInTheDocument()
  })

  it("previews policy live: missing receipt → will be rejected; per-night over limit is flagged", async () => {
    await signIn()
    const { user } = renderAt("/claims/new", routes)
    await screen.findByTestId("line-0-cat-HOTEL")
    // wait for policy to load so the preview has rules
    await waitFor(() => expect(screen.queryAllByText(/Add an amount|Auto-approves|review|rejected/).length).toBeGreaterThan(0))
    await user.click(screen.getByTestId("line-0-cat-HOTEL"))
    await user.type(screen.getByTestId("line-0-amount"), "22500")
    await user.type(screen.getByTestId("line-0-city"), "Mumbai")
    await user.keyboard("{Escape}")
    await user.type(screen.getByTestId("line-0-nights"), "3")
    expect((await screen.findAllByText("Will be rejected")).length).toBeGreaterThan(0)
    expect(screen.getByText(/7,500.00\/night is over the tier-1 limit/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId("running-total")).toHaveTextContent("22,500.00"))
  })

  it("adds and removes lines (max 20) and keeps the running total", async () => {
    await signIn()
    const { user } = renderAt("/claims/new", routes)
    await user.type(await screen.findByTestId("line-0-amount"), "100")
    await user.click(screen.getByTestId("add-line"))
    await user.type(screen.getByTestId("line-1-amount"), "250.5")
    await waitFor(() => expect(screen.getByTestId("running-total")).toHaveTextContent("350.50"))
    await user.click(screen.getByTestId("remove-line-1"))
    await waitFor(() => expect(screen.getByTestId("running-total")).toHaveTextContent("100.00"))
  })

  it("rejects receipts that aren't JPEG/PNG/PDF before uploading", async () => {
    await signIn()
    renderAt("/claims/new", routes)
    await screen.findByTestId("line-0")
    const input = screen.getByTestId("line-0").querySelector<HTMLInputElement>('input[type=file][accept^="image/jpeg"]')!
    fireEvent.change(input, { target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } })
    expect(await screen.findByText("Use a JPEG, PNG or PDF.")).toBeInTheDocument()
  })

  it("creates and submits a valid claim exactly once even on double click", async () => {
    await signIn()
    const { user } = renderAt("/claims/new", [...routes, { path: "/claims/:id", element: <div data-testid="detail" /> }])
    await user.type(await screen.findByTestId("claim-title"), "Cab")
    await user.click(screen.getByTestId("line-0-cat-LOCAL_CAB"))
    await user.type(screen.getByTestId("line-0-amount"), "300")
    await user.type(screen.getByTestId("line-0-vendor"), "Ola")
    await user.dblClick(screen.getByTestId("submit-claim"))
    expect(await screen.findByTestId("detail")).toBeInTheDocument()
    const { Api } = await import("@/api/endpoints")
    const mine = await Api.listMyClaims()
    expect(mine.content.filter((c) => c.title === "Cab")).toHaveLength(1)
  })
})

describe("My claims (ST-04)", () => {
  it("lists only my claims with status badges and filters by tab", async () => {
    await signIn()
    const { user } = renderAt("/claims", [{ path: "/claims", element: <ClaimsPage /> }])
    expect(await screen.findAllByText("Needs clarification")).not.toHaveLength(0)
    await user.click(screen.getByRole("tab", { name: /Drafts/ }))
    await waitFor(() => expect(screen.queryByText("Chennai data-centre visit")).toBeNull())
    expect(screen.getAllByText("Delhi offsite supplies").length).toBeGreaterThan(0)
  })
})

describe("Approvals (ST-05, ST-07)", () => {
  it("auditor can select all eligible rows and sees the bulk bar", async () => {
    await signIn("auditor.demo@expenseflow.test")
    const { user } = renderAt("/approvals", [{ path: "/approvals", element: <ApprovalsPage /> }])
    await user.click(await screen.findByTestId("select-all"))
    const bar = await screen.findByRole("region", { name: "Bulk actions" })
    expect(within(bar).getByText("selected")).toBeInTheDocument()
  })

  it("manager does not get bulk selection", async () => {
    await signIn("mgr.demo@expenseflow.test")
    renderAt("/approvals", [{ path: "/approvals", element: <ApprovalsPage /> }])
    await screen.findAllByText(/Brand shoot props|Kolkata vendor meeting/)
    expect(screen.queryByTestId("select-all")).toBeNull()
  })
})

describe("Policy page", () => {
  it("the threshold tool explains who approves a given total (strict thresholds)", async () => {
    await signIn()
    const { user } = renderAt("/policy", [{ path: "/policy", element: <PolicyPage /> }])
    const input = await screen.findByTestId("policy-try-amount")
    await user.clear(input)
    await user.type(input, "25000")
    expect(screen.queryByText("Auditor", { selector: "span" })).toBeNull()
    await user.type(input, "1")
    expect(await screen.findByText("Auditor", { selector: "span" })).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, "4000")
    expect(await screen.findByText(/No approver if every line is clean/)).toBeInTheDocument()
  })
})

describe("Design-system components", () => {
  it("FlagList shows +N with an accessible label listing the hidden flags", () => {
    render(
      <TooltipProvider>
        <FlagList flags={["OVER_LIMIT", "WEEKEND", "DUPLICATE"]} max={2} />
      </TooltipProvider>,
    )
    expect(screen.getByTestId("flags-more")).toHaveAccessibleName("1 more: Duplicate")
  })

  it("CityCombobox: type, arrow down, Enter selects; free text is allowed", async () => {
    function Harness() {
      const [v, setV] = useState("")
      return (
        <>
          <CityCombobox value={v} onChange={setV} cities={["Mumbai", "Delhi", "Bengaluru"]} testId="city" />
          <output data-testid="val">{v}</output>
        </>
      )
    }
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByTestId("city")
    await user.type(input, "del")
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Delhi", "Use “del”"])
    await user.keyboard("{Enter}")
    expect(screen.getByTestId("val")).toHaveTextContent("Delhi")
    expect(screen.queryByRole("listbox")).toBeNull()
    await user.clear(input)
    await user.type(input, "Goa")
    await user.keyboard("{Enter}")
    expect(screen.getByTestId("val")).toHaveTextContent("Goa")
  })
})
