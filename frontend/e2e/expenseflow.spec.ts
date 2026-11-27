import { expect, test } from "@playwright/test"
import { USERS, decide, isMobile, loginAs, openFromList, openNav, statusBadge, submitClaim, unique, fillClaim } from "./helpers"

/** README §12 — E2E-01 … E2E-10. Each test creates its own uniquely named data. */

test.describe("E2E-01 login per role + correct menu", () => {
  const cases = [
    { role: "employee", home: /\/claims$/, show: ["My claims", "Policy"], hide: ["Dashboard", "Approvals", "Payouts", "Delegation"] },
    { role: "manager", home: /\/approvals$/, show: ["Approvals", "My claims", "Delegation", "Policy"], hide: ["Dashboard", "Payouts"] },
    { role: "auditor", home: /\/dashboard$/, show: ["Dashboard", "Approvals", "My claims", "Delegation"], hide: ["Payouts"] },
    { role: "head", home: /\/dashboard$/, show: ["Dashboard", "Approvals", "My claims", "Payouts", "Delegation", "Policy"], hide: [] },
  ] as const
  for (const c of cases) {
    test(`${c.role} lands on their home and sees only their menu`, async ({ page }) => {
      await loginAs(page, USERS[c.role])
      await expect(page).toHaveURL(c.home)
      const nav = await openNav(page)
      for (const item of c.show) await expect(nav.getByRole("link", { name: item })).toBeVisible()
      for (const item of c.hide) await expect(nav.getByRole("link", { name: item })).toHaveCount(0)
    })
  }

  test("wrong password shows an error and stays on login", async ({ page }) => {
    await page.goto("/login")
    await page.getByTestId("login-email").fill(USERS.employee)
    await page.getByTestId("login-password").fill("wrong-password")
    await page.getByTestId("login-submit").click()
    await expect(page.getByRole("alert")).toContainText("Email or password is incorrect")
    await expect(page).toHaveURL(/\/login$/)
  })

  test("a role can't open another role's page by URL", async ({ page }) => {
    await loginAs(page, USERS.employee)
    await page.goto("/payouts")
    await expect(page).toHaveURL(/\/claims$/)
  })
})

test("E2E-02 create a draft with receipts, reopen it and edit", async ({ page }) => {
  const title = unique("Draft trip")
  await loginAs(page, USERS.employee)
  await page.goto("/claims/new")
  await fillClaim(page, title, [
    { category: "MEALS", amount: 900, vendor: "Cafe Madras", city: "Mumbai", receipt: true },
    { category: "LOCAL_CAB", amount: 650, vendor: "Ola", city: "Mumbai", receipt: true },
  ])
  await page.getByTestId("save-draft").click()
  await expect(page.getByText("Draft saved")).toBeVisible()

  await page.goto("/claims")
  await openFromList(page, title)
  await expect(statusBadge(page)).toHaveText("Draft")
  await expect(page.getByText("₹1,550.00").or(page.getByText(/1,550/)).first()).toBeVisible()

  await page.getByTestId("edit-claim").click()
  await page.getByTestId("line-1-amount").fill("700")
  await expect(page.getByTestId("line-1").getByText(/Receipt #\d+|Attached/).first()).toBeVisible() // receipt kept on reopen
  await page.getByTestId("save-draft").click()
  await expect(page.getByText("Draft saved")).toBeVisible()
  await page.goto("/claims")
  await openFromList(page, title)
  await expect(page.locator("main").getByText(/1,600/).first()).toBeVisible()
})

test("E2E-03 double-clicking Submit creates exactly one claim", async ({ page }) => {
  const title = unique("Double submit")
  await loginAs(page, USERS.employee)
  await page.goto("/claims/new")
  await fillClaim(page, title, [{ category: "LOCAL_CAB", amount: 300, vendor: "Ola", city: "Pune" }])
  await page.getByTestId("submit-claim").dblclick()
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()

  await page.goto("/claims")
  await page.getByTestId("claims-search").fill(title)
  const rows = isMobile(page) ? page.locator('[data-testid^="claim-card-"]') : page.locator('[data-testid^="claim-row-"]')
  await expect(rows).toHaveCount(1)
})

test("E2E-04 a line above ₹500 without a receipt is auto-rejected with a reason", async ({ page }) => {
  const title = unique("No receipt")
  await loginAs(page, USERS.employee)
  await page.goto("/claims/new")
  await fillClaim(page, title, [{ category: "MEALS", amount: 800, vendor: "Cafe", city: "Pune" }])
  await expect(page.getByText("Will be rejected").filter({ visible: true }).first()).toBeVisible() // live preview warns first
  await page.getByTestId("submit-claim").click()
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
  await expect(statusBadge(page)).toHaveText("Rejected")
  await expect(page.getByText("Rejected by policy", { exact: true })).toBeVisible()
  await expect(page.getByTestId("line-row-1").getByText("No receipt").first()).toBeVisible()
})

test("E2E-05 over-limit hotel is routed; manager approves ≤ ₹25,000 → Approved", async ({ page }) => {
  test.slow() // switches between several roles
  const title = unique("Mumbai hotel")
  await loginAs(page, USERS.employee)
  await submitClaim(page, title, [{ category: "HOTEL", amount: 21000, vendor: "Hotel Sea Pearl", city: "Mumbai", nights: 3, receipt: true }])
  await expect(statusBadge(page)).toHaveText("With manager")
  await expect(page.getByTestId("line-row-1").getByText("Over limit")).toBeVisible()
  await expect(page.getByText(/7,000 per night is above the tier-1 limit/)).toBeVisible()

  await loginAs(page, USERS.manager)
  await openFromList(page, title)
  await decide(page, "approve", "Client visit confirmed")

  await loginAs(page, USERS.employee)
  await openFromList(page, title)
  await expect(statusBadge(page)).toHaveText("Approved")
})

test("E2E-06 claim above ₹25,000: manager → auditor bulk approve → Approved", async ({ page }) => {
  test.slow() // switches between several roles
  const title = unique("Big conference")
  await loginAs(page, USERS.employee)
  await submitClaim(page, title, [{ category: "HOTEL", amount: 30000, vendor: "ITC Gardenia", city: "Bengaluru", nights: 3, receipt: true }])

  await loginAs(page, USERS.manager)
  await openFromList(page, title)
  await decide(page, "approve")

  await loginAs(page, USERS.auditor)
  await page.goto("/approvals")
  await page.getByTestId("filter-flag-OVER_LIMIT").click()
  const row = page.locator("tr:visible, li:visible").filter({ hasText: title })
  await row.getByRole("checkbox").click()
  await page.getByTestId("bulk-approve").click()
  await page.getByTestId("confirm-bulk").click()
  await expect(page.getByRole("dialog").getByText("Bulk approve results")).toBeVisible()
  await expect(page.getByRole("dialog").getByText("Approved").first()).toBeVisible()

  await loginAs(page, USERS.employee)
  await openFromList(page, title)
  await expect(statusBadge(page)).toHaveText("Approved")
})

test("E2E-07 send back → employee edits → resubmits → routed again", async ({ page }) => {
  test.slow() // switches between several roles
  const title = unique("Needs GST")
  await loginAs(page, USERS.employee)
  await submitClaim(page, title, [{ category: "FLIGHT", amount: 7000, vendor: "IndiGo", city: "Delhi", receipt: true }])

  await loginAs(page, USERS.manager)
  await openFromList(page, title)
  await page.getByTestId("send-back").click()
  await expect(page.getByTestId("confirm-decision")).toBeDisabled() // comment is required
  await page.getByTestId("decision-comment").fill("Please attach the GST invoice")
  await page.getByTestId("confirm-decision").click()
  await expect(page).toHaveURL(/\/approvals$/)

  await loginAs(page, USERS.employee)
  await openFromList(page, title)
  await expect(statusBadge(page)).toHaveText("Needs clarification")
  await expect(page.getByText("Please attach the GST invoice").first()).toBeVisible()
  await page.getByTestId("edit-claim").click()
  await page.getByTestId("line-0-amount").fill("6800")
  await page.getByTestId("submit-claim").click()
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
  await expect(statusBadge(page)).toHaveText("With manager")
})

test("E2E-08 a delegate approves for the manager on leave; both names are recorded", async ({ page }) => {
  test.slow() // switches between several roles
  const title = unique("Delegated trip")
  await loginAs(page, USERS.delegatorReport)
  await submitClaim(page, title, [{ category: "FLIGHT", amount: 5600, vendor: "Air India", city: "Delhi", receipt: true }])

  await loginAs(page, USERS.manager) // the delegate
  await openFromList(page, title)
  await decide(page, "approve")
  await page.goto("/approvals")

  await loginAs(page, USERS.head) // head can view any claim and its audit trail
  await page.goto("/approvals")
  await loginAs(page, USERS.delegatorReport)
  await page.goto("/claims")
  await openFromList(page, title)
  await expect(page.getByText(/on behalf of Neha Kulkarni/)).toBeVisible()
})

test("E2E-09 employee can't open a colleague's claim; manager can't approve their own", async ({ page }) => {
  test.slow() // switches between several roles
  await loginAs(page, USERS.colleague)
  await page.goto("/claims")
  await page.getByRole("link", { name: /Kolkata vendor meeting|Conference pass/ }).first().click()
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  const colleagueUrl = page.url()

  await loginAs(page, USERS.employee)
  await page.goto(colleagueUrl)
  await expect(page.getByText("Not found", { exact: true })).toBeVisible()
  await expect(page.getByText("Claim not found")).toBeVisible()

  const title = unique("Own claim")
  await loginAs(page, USERS.manager)
  await submitClaim(page, title, [{ category: "FLIGHT", amount: 7000, vendor: "IndiGo", city: "Delhi", receipt: true }])
  await expect(page.getByTestId("approve")).toHaveCount(0) // UI offers no decision on your own claim
  // …and the API refuses it too (R15)
  const id = Number(page.url().split("/").pop())
  const status = await page.evaluate(async (claimId) => {
    const { Api } = await import("/src/api/endpoints.ts")
    try {
      await Api.approveClaim(claimId)
      return 200
    } catch (e) {
      return (e as { status: number }).status
    }
  }, id)
  expect(status).toBe(403)
})

test("E2E-10 head payout: bank down → waiting → bank up → Paid", async ({ page }) => {
  test.slow() // switches between several roles
  await loginAs(page, USERS.head)
  await page.goto("/payouts")
  const firstClaim = page.locator("main").getByRole("link").filter({ hasText: /\w/ }).first()
  const claimHref = await firstClaim.getAttribute("href")
  await page.getByTestId("payout-select-all").click()
  await page.getByTestId("create-batch").click()
  await page.getByTestId("confirm-batch").click()

  const batch = page.locator('[data-testid^="batch-"]').first()
  await expect(batch.getByText("Waiting for bank")).toBeVisible() // bank down on first send
  await expect(batch.getByText(/Attempt 1/)).toBeVisible()
  await batch.getByRole("button", { name: /Retry now/ }).click() // bank back up
  await expect(batch.getByText("Sent")).toBeVisible()
  await expect(batch.getByText(/Bank ref BNK-/)).toBeVisible()

  await page.goto(claimHref!)
  await expect(statusBadge(page)).toHaveText("Paid")
})
