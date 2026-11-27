/**
 * Captures the UI-design screenshots into ../evidence/ui/ (1440 px and 375 px, light; plus dark samples).
 * Needs the app running (mock): `npm run dev` → http://localhost:5173. Then: `node scripts/capture-ui.mjs`
 * Override the URL with BASE_URL=...
 */
import { chromium } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

const BASE = process.env.BASE_URL ?? "http://localhost:5173"
const OUT = resolve(import.meta.dirname, "../../evidence/ui")
mkdirSync(OUT, { recursive: true })

const PW = "Demo@123"
const users = { employee: "emp.demo@expenseflow.test", manager: "mgr.demo@expenseflow.test", head: "head.demo@expenseflow.test" }

function lastWeekday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}
const settle = (page, ms = 1600) => page.waitForTimeout(ms)
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex")

async function login(page, email) {
  await page.goto(`${BASE}/login`)
  await page.evaluate(() => ["ef.token", "ef.user", "ef.exp"].forEach((k) => localStorage.removeItem(k)))
  await page.goto(`${BASE}/login`)
  await page.getByTestId("login-email").fill(email)
  await page.getByTestId("login-password").fill(PW)
  await page.getByTestId("login-submit").click()
  await page.waitForURL((u) => !u.pathname.endsWith("/login"))
}

async function shot(page, name, suffix) {
  await settle(page)
  const file = `${OUT}/${name}-${suffix}.png`
  await page.screenshot({ path: file })
  console.log("saved", file)
}

async function run(viewport, suffix, theme = "light", only) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: suffix === "375" ? 2 : 1, isMobile: suffix === "375", hasTouch: suffix === "375" })
  await ctx.addInitScript((t) => localStorage.setItem("ef.theme", t), theme)
  const page = await ctx.newPage()
  const want = (n) => !only || only.includes(n)

  // 01 Login
  await page.goto(`${BASE}/login`)
  if (want("01-login")) await shot(page, "01-login", suffix)

  // 02 My claims (employee)
  await login(page, users.employee)
  await page.goto(`${BASE}/claims`)
  if (want("02-my-claims")) await shot(page, "02-my-claims", suffix)

  // 03 Claim capture — golden flow hotel line, filled, with live policy preview
  await page.goto(`${BASE}/claims/new`)
  await page.getByTestId("claim-title").fill("Mumbai client visit")
  await page.getByTestId("line-0-cat-HOTEL").click()
  await page.getByTestId("line-0-amount").fill("22500")
  await page.getByTestId("line-0-date").fill(lastWeekday())
  await page.getByTestId("line-0-vendor").fill("Hotel Sea Pearl")
  await page.getByTestId("line-0-city").fill("Mumbai")
  await page.keyboard.press("Escape")
  await page.getByTestId("line-0-nights").fill("3")
  await page.getByTestId("line-0").locator('input[type=file][accept^="image/jpeg"]').setInputFiles({ name: "hotel-sea-pearl.png", mimeType: "image/png", buffer: Buffer.concat([PNG, Buffer.from(String(Date.now()))]) })
  await page.getByTestId("line-0").getByText(/Attached/).waitFor()
  if (want("03-claim-capture")) await shot(page, "03-claim-capture", suffix)

  // 04 Claim detail (submitted → routed with flags)
  await page.getByTestId("submit-claim").click()
  await page.getByRole("heading", { level: 1, name: "Mumbai client visit" }).waitFor()
  const claimUrl = new URL(page.url())
  const id = claimUrl.pathname.split("/").pop()
  await page.waitForTimeout(4500) // let the "submitted" toast clear
  if (want("04-claim-detail")) await shot(page, "04-claim-detail", suffix)

  // 05 Approval queue + 06 approver view (manager)
  await login(page, users.manager)
  await page.goto(`${BASE}/approvals`)
  if (want("05-approval-queue")) await shot(page, "05-approval-queue", suffix)
  await page.goto(`${BASE}/approvals/${id}`)
  if (want("06-approver-view")) await shot(page, "06-approver-view", suffix)

  // 07 Payouts (head) — create a batch so "Waiting for bank" is visible
  await login(page, users.head)
  await page.goto(`${BASE}/payouts`)
  // batch one claim, so the screenshot shows both eligible claims and a waiting batch
  await page.locator('[data-testid^="payout-select-"]:not([data-testid="payout-select-all"])').first().click()
  await page.getByTestId("create-batch").click()
  await page.getByTestId("confirm-batch").click()
  await page.locator('[data-testid^="batch-"]').first().waitFor()
  await page.waitForTimeout(4500) // let the toast clear
  if (want("07-payouts")) await shot(page, "07-payouts", suffix)

  // 08 Dashboard
  await page.goto(`${BASE}/dashboard`)
  if (want("08-dashboard")) await shot(page, "08-dashboard", suffix, 2200)

  // 09 Policy
  await page.goto(`${BASE}/policy`)
  if (want("09-policy")) await shot(page, "09-policy", suffix)

  await browser.close()
}

await run({ width: 1440, height: 900 }, "1440")
await run({ width: 375, height: 812 }, "375")
await run({ width: 1440, height: 900 }, "1440-dark", "dark", ["01-login", "08-dashboard", "06-approver-view"])
await run({ width: 375, height: 812 }, "375-dark", "dark", ["03-claim-capture"])
