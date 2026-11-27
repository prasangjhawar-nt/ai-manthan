import { expect, type Page } from "@playwright/test"

export const USERS = {
  employee: "emp.demo@expenseflow.test",
  colleague: "colleague.demo@expenseflow.test",
  manager: "mgr.demo@expenseflow.test",
  auditor: "auditor.demo@expenseflow.test",
  head: "head.demo@expenseflow.test",
  // Reports to mgr.leave (on leave, delegated to mgr.demo). Override for other seeds.
  delegatorReport: process.env.E2E_DELEGATOR_REPORT ?? "rohan.iyer@expenseflow.test",
} as const
export const PASSWORD = process.env.E2E_PASSWORD ?? "Demo@123"

export const unique = (label: string) => `${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`

/** Most recent Mon–Fri within the last week (local time), so no WEEKEND flag sneaks in. */
export function lastWeekday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768

/** Signs out (keeps the mock DB in sessionStorage) and signs in as `email`. */
export async function loginAs(page: Page, email: string) {
  await page.goto("/login")
  await page.evaluate(() => {
    localStorage.removeItem("ef.token")
    localStorage.removeItem("ef.user")
    localStorage.removeItem("ef.exp")
  })
  await page.goto("/login")
  await page.getByTestId("login-email").fill(email)
  await page.getByTestId("login-password").fill(PASSWORD)
  await page.getByTestId("login-submit").click()
  await expect(page).not.toHaveURL(/\/login$/)
}

/** Opens the navigation (drawer on mobile) and returns the nav landmark. */
export async function openNav(page: Page) {
  if (isMobile(page)) await page.getByTestId("menu").click()
  const nav = page.getByRole("navigation", { name: "Main" }).last()
  await expect(nav).toBeVisible()
  return nav
}

export interface LineSpec {
  category: "HOTEL" | "FLIGHT" | "MEALS" | "LOCAL_CAB" | "TRAIN" | "OTHER"
  amount: number
  vendor: string
  city?: string
  nights?: number
  receipt?: boolean
  date?: string
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex")

/** Fills the claim form (on /claims/new or /claims/:id/edit). */
export async function fillClaim(page: Page, title: string, lines: LineSpec[]) {
  await page.getByTestId("claim-title").fill(title)
  for (const [i, l] of lines.entries()) {
    if (i > 0) await page.getByTestId("add-line").click()
    await page.getByTestId(`line-${i}-cat-${l.category}`).click()
    await page.getByTestId(`line-${i}-amount`).fill(String(l.amount))
    await page.getByTestId(`line-${i}-date`).fill(l.date ?? lastWeekday())
    await page.getByTestId(`line-${i}-vendor`).fill(l.vendor)
    if (l.city) {
      await page.getByTestId(`line-${i}-city`).fill(l.city)
      await page.keyboard.press("Escape")
    }
    if (l.nights) await page.getByTestId(`line-${i}-nights`).fill(String(l.nights))
    if (l.receipt) {
      const input = page.getByTestId(`line-${i}`).locator('input[type=file][accept^="image/jpeg"]')
      await input.setInputFiles({ name: `${l.vendor.replace(/\W+/g, "-")}-${Date.now()}-${i}.png`, mimeType: "image/png", buffer: Buffer.concat([PNG, Buffer.from(`${title}-${i}-${Math.random()}`)]) })
      await expect(page.getByTestId(`line-${i}`).getByText(/Attached · SHA-256 stored|uploaded before/)).toBeVisible()
    }
  }
}

/** Creates and submits a claim as the signed-in user; ends on its detail page. */
export async function submitClaim(page: Page, title: string, lines: LineSpec[]) {
  await page.goto("/claims/new")
  await fillClaim(page, title, lines)
  await page.getByTestId("submit-claim").click()
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
}

/** Opens a claim from the current list/queue by its title (works for table rows and mobile cards). */
export async function openFromList(page: Page, title: string) {
  await page.getByRole("link", { name: new RegExp(escapeRe(title)) }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
}

export async function decide(page: Page, action: "approve" | "send-back" | "reject", comment?: string) {
  await page.getByTestId(action).click()
  if (comment) await page.getByTestId("decision-comment").fill(comment)
  await page.getByTestId("confirm-decision").click()
  await expect(page).toHaveURL(/\/approvals$/)
}

export const statusBadge = (page: Page) => page.locator("main").getByText(/^(Draft|With manager|With auditor|With finance head|Needs clarification|Approved|Rejected|In payout|Paid)$/).first()

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
