import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, test, type Page } from "@playwright/test"
import { USERS, decide, escapeRe, fillClaim, lastWeekday, loginAs, openFromList, statusBadge, submitClaim, unique } from "./helpers"

/**
 * Evidence capture (not one of the README §12 cases):
 *  - SHOTS   every README §8 route, as each README §0 demo user, full page, at the project's width
 *            (desktop = 1440x900, mobile-375 = 375x812) → <repo>/evidence/ui/<route>-<width>.png
 *  - GOLDEN  README §3 golden flow recorded with video: "on" → <repo>/evidence/demo/golden-flow-<width>.webm
 *
 * Naming: each route is shot once under the exact name <route>-<width>.png by its "owner" role
 * (the role §8 builds the screen for). Every other demo user who can open that route is shot as
 * <route>-<user>-<width>.png, so no file is overwritten. Routes a user's role can't open are asserted
 * to redirect away (RequireAuth) and are not shot.
 */

// Playwright only allows video options at file level (they force a new worker). The golden flow
// copies its recording into evidence/demo/; the screenshot tests' videos stay in e2e/.results.
test.use({ video: "on" })

const EVIDENCE = fileURLToPath(new URL("../../evidence/", import.meta.url))
const UI_DIR = `${EVIDENCE}ui/`
const DEMO_DIR = `${EVIDENCE}demo/`

type Role = "EMPLOYEE" | "MANAGER" | "AUDITOR" | "HEAD"
const DEMO_USERS: { key: string; email: string; role: Role }[] = [
  { key: "employee", email: USERS.employee, role: "EMPLOYEE" },
  { key: "colleague", email: USERS.colleague, role: "EMPLOYEE" },
  { key: "manager", email: USERS.manager, role: "MANAGER" },
  { key: "mgr-leave", email: "mgr.leave@expenseflow.test", role: "MANAGER" },
  { key: "auditor", email: USERS.auditor, role: "AUDITOR" },
  { key: "head", email: USERS.head, role: "HEAD" },
]

const ALL: Role[] = ["EMPLOYEE", "MANAGER", "AUDITOR", "HEAD"]
const APPROVERS: Role[] = ["MANAGER", "AUDITOR", "HEAD"]

/** README §8 routes. `owner` = demo user whose shot gets the plain <route>-<width>.png name. */
interface RouteSpec {
  slug: string
  roles: Role[]
  owner: string
  /** Navigates to the route; returns false if the user has nothing to open (e.g. empty queue). */
  open: (page: Page) => Promise<boolean>
}

const goto = (path: string) => async (page: Page) => {
  await page.goto(path)
  return true
}

/** Opens the first link matching `href` found on `listPath`. */
const firstFrom = (listPath: string, href: RegExp, suffix = "") => async (page: Page) => {
  await page.goto(listPath)
  await settle(page)
  const links = page.locator("main a[href]")
  const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))
  const target = hrefs.find((h) => href.test(h))
  if (!target) return false
  await page.goto(target + suffix)
  return true
}

const ROUTES: RouteSpec[] = [
  { slug: "claims", roles: ALL, owner: "employee", open: goto("/claims") },
  { slug: "claims-new", roles: ALL, owner: "employee", open: goto("/claims/new") },
  { slug: "claims-id", roles: ALL, owner: "employee", open: firstFrom("/claims", /^\/claims\/\d+$/) },
  { slug: "claims-id-edit", roles: ALL, owner: "employee", open: openOwnDraft },
  { slug: "approvals", roles: APPROVERS, owner: "manager", open: goto("/approvals") },
  { slug: "approvals-id", roles: APPROVERS, owner: "manager", open: firstFrom("/approvals", /^\/approvals\/\d+$/) },
  { slug: "payouts", roles: ["HEAD"], owner: "head", open: goto("/payouts") },
  { slug: "dashboard", roles: ["AUDITOR", "HEAD"], owner: "head", open: goto("/dashboard") },
  { slug: "policy", roles: ALL, owner: "employee", open: goto("/policy") },
]

/** /claims/:id/edit needs an editable claim the user owns, so save a fresh draft and reopen it. */
async function openOwnDraft(page: Page) {
  await page.goto("/claims/new")
  const title = unique("Screenshot draft")
  await fillClaim(page, title, [
    { category: "HOTEL", amount: 12000, vendor: "Hotel Sea Pearl", city: "Mumbai", nights: 2, receipt: true },
    { category: "MEALS", amount: 450, vendor: "Cafe Madras", city: "Mumbai" },
  ])
  await page.getByTestId("save-draft").click()
  await expect(page.getByText("Draft saved").first()).toBeVisible()
  await page.goto("/claims")
  await openFromList(page, title)
  await page.getByTestId("edit-claim").click()
  await expect(page).toHaveURL(/\/claims\/\d+\/edit$/)
  return true
}

/** Waits for data views to leave their loading state and for toasts/animations to finish. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle")
  await expect(page.locator("main [aria-busy='true'], main .skeleton")).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
}

/**
 * The AppShell is `h-dvh overflow-hidden` and scrolls inside an inner `overflow-y-auto` pane, so a plain
 * fullPage shot is only viewport-tall. Applied only while the screenshot is taken: let the document grow.
 */
const UNLOCK_SHELL = `
  html, body, #root { height: auto !important; overflow: visible !important; }
  .flex.h-dvh.overflow-hidden { height: auto !important; min-height: 100dvh; overflow: visible !important; }
  .scroll-thin.overflow-y-auto.flex-1 { overflow: visible !important; }
`

async function shoot(page: Page, name: string) {
  await settle(page)
  // Let toasts from the previous step disappear so they don't land in the evidence.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 8_000 }).catch(() => {})
  await page.screenshot({ path: `${UI_DIR}${name}.png`, fullPage: true, animations: "disabled", style: UNLOCK_SHELL })
}

const widthOf = (page: Page) => page.viewportSize()!.width

test.describe("Evidence: README §8 screens per README §0 demo user", () => {
  test.beforeAll(() => mkdirSync(UI_DIR, { recursive: true }))

  test("login (public)", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByTestId("login-email")).toBeVisible()
    await shoot(page, `login-${widthOf(page)}`)
  })

  for (const u of DEMO_USERS) {
    test(`all §8 routes as ${u.key} (${u.email})`, async ({ page }) => {
      test.slow() // up to 9 routes + one draft per user
      await loginAs(page, u.email)
      const w = widthOf(page)

      for (const r of ROUTES) {
        await test.step(`${r.slug}`, async () => {
          if (!r.roles.includes(u.role)) {
            await page.goto(`/${r.slug.replace(/-id.*$/, "").replace(/-/g, "/")}`)
            await expect(page, `${u.role} must be redirected away from ${r.slug}`).not.toHaveURL(new RegExp(`/${escapeRe(r.slug.split("-")[0])}(/|$)`))
            return
          }
          const opened = await r.open(page)
          if (!opened) {
            test.info().annotations.push({ type: "skipped-route", description: `${r.slug}: nothing to open for ${u.key}` })
            return
          }
          await expect(page).not.toHaveURL(/\/login$/)
          const name = u.key === r.owner ? `${r.slug}-${w}` : `${r.slug}-${u.key}-${w}`
          await shoot(page, name)
        })
      }
    })
  }
})

/** Most recent Saturday within the last week (local time) — the README §3 weekend cab. */
function lastSaturday() {
  const d = new Date()
  do {
    d.setDate(d.getDate() - 1)
  } while (d.getDay() !== 6)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

test.describe("Evidence: README §3 golden flow (video)", () => {
  test.beforeAll(() => mkdirSync(DEMO_DIR, { recursive: true }))

  test("golden demo flow, recorded", async ({ page }) => {
    test.setTimeout(240_000)
    const title = unique("Mumbai client visit")
    const weekday = lastWeekday()
    const width = widthOf(page)
    let claimId = 0

    await test.step("1. EMPLOYEE creates ~₹30,500 claim, saves draft, double-clicks Submit", async () => {
      await loginAs(page, USERS.employee)
      await page.goto("/claims/new")
      await fillClaim(page, title, [
        { category: "HOTEL", amount: 22500, vendor: "Hotel Sea Pearl", city: "Mumbai", nights: 3, receipt: true, date: weekday },
        { category: "MEALS", amount: 1200, vendor: "Cafe Madras", city: "Mumbai", receipt: true, date: weekday },
        { category: "LOCAL_CAB", amount: 800, vendor: "Ola", city: "Mumbai", receipt: true, date: lastSaturday() },
        { category: "FLIGHT", amount: 6000, vendor: "IndiGo", city: "Mumbai", receipt: true, date: weekday },
      ])
      await page.getByTestId("save-draft").click()
      await expect(page.getByText("Draft saved").first()).toBeVisible()
      await page.getByTestId("submit-claim").dblclick()
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
      claimId = Number(page.url().split("/").pop())

      await page.goto("/claims")
      await page.getByTestId("claims-search").fill(title)
      await expect(page.locator('[data-testid^="claim-row-"]:visible, [data-testid^="claim-card-"]:visible')).toHaveCount(1)
    })

    await test.step("2. SYSTEM flags OVER_LIMIT, WEEKEND, NO_POLICY → With manager", async () => {
      await page.goto(`/claims/${claimId}`)
      await expect(statusBadge(page)).toHaveText("With manager")
      for (const flag of ["Over limit", "Weekend", "No policy"]) await expect(page.locator("main").getByText(flag).first()).toBeVisible()
    })

    await test.step("3. MANAGER reviews receipts + flags and approves → With auditor (R9)", async () => {
      await loginAs(page, USERS.manager)
      await openFromList(page, title)
      await expect(page.getByText("Receipts").first()).toBeVisible()
      await decide(page, "approve", "Client visit confirmed")
    })

    await test.step("4. EMPLOYEE opens colleague's claim → 404 (R13); MANAGER approves own → 403 (R15)", async () => {
      await loginAs(page, USERS.colleague)
      await page.goto("/claims")
      await page.getByRole("link", { name: /Kolkata vendor meeting|Conference pass/ }).first().click()
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      const colleagueUrl = page.url()

      await loginAs(page, USERS.employee)
      await page.goto(colleagueUrl)
      await expect(page.getByText("Claim not found")).toBeVisible()

      await loginAs(page, USERS.manager)
      await submitClaim(page, unique("Manager own trip"), [{ category: "FLIGHT", amount: 7000, vendor: "IndiGo", city: "Delhi", receipt: true }])
      await expect(page.getByTestId("approve")).toHaveCount(0) // UI offers no decision on your own claim
      const ownId = Number(page.url().split("/").pop())
      const status = await page.evaluate(async (id) => {
        const { Api } = await import("/src/api/endpoints.ts")
        try {
          await Api.approveClaim(id)
          return 200
        } catch (e) {
          return (e as { status: number }).status
        }
      }, ownId)
      expect(status).toBe(403)
    })

    await test.step("5. AUDITOR filters flag = OVER_LIMIT and bulk-approves → Approved", async () => {
      await loginAs(page, USERS.auditor)
      await page.goto("/approvals")
      await page.getByTestId("filter-flag-OVER_LIMIT").click()
      await page.locator("tr:visible, li:visible").filter({ hasText: title }).getByRole("checkbox").click()
      await page.getByTestId("bulk-approve").click()
      await page.getByTestId("confirm-bulk").click()
      await expect(page.getByRole("dialog").getByText("Bulk approve results")).toBeVisible()
      await expect(page.getByRole("dialog").getByText("Approved").first()).toBeVisible()
      await page.keyboard.press("Escape")
    })

    await test.step("6. HEAD creates payout batch: bank down → Waiting for bank → retry → Sent (R12)", async () => {
      await loginAs(page, USERS.head)
      await page.goto("/payouts")
      await page.getByTestId("payout-select-all").click() // same as E2E-10: our claim is among the eligible ones
      await page.getByTestId("create-batch").click()
      await page.getByTestId("confirm-batch").click()
      const batch = page.locator('[data-testid^="batch-"]').first()
      await expect(batch.getByText("Waiting for bank")).toBeVisible()
      await batch.getByRole("button", { name: /Retry now/ }).click()
      await expect(batch.getByText("Sent")).toBeVisible()
    })

    await test.step("7. HEAD opens the dashboard and the claim's audit timeline (R14)", async () => {
      await page.goto("/dashboard")
      await settle(page)
      await page.mouse.wheel(0, 1200)
      await page.goto(`/claims/${claimId}`)
      await expect(statusBadge(page)).toHaveText("Paid")
      const activity = page.getByText("Activity", { exact: true }).first()
      await activity.scrollIntoViewIfNeeded()
      await expect(activity).toBeVisible()
      await page.waitForTimeout(1500) // hold the final frame for the recording
    })

    // Video is finalised only once the page closes; then copy it into evidence/demo/.
    const video = page.video()
    await page.close()
    await video?.saveAs(`${DEMO_DIR}golden-flow-${width}.webm`)
  })
})
