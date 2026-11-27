/**
 * Generates low-fidelity box-sketch wireframes into ../docs/wireframes/*.png.
 * Each screen is described as labelled boxes on a 1440×900 (desktop) and 375×812 (mobile) grid.
 * Run: node scripts/wireframes.mjs
 */
import { chromium } from "@playwright/test"
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

const OUT = resolve(import.meta.dirname, "../../docs/wireframes")
mkdirSync(OUT, { recursive: true })

// [x, y, w, h, label, kind?]  kind: "nav" | "primary" | "accent" | undefined
const SHELL = [
  [0, 0, 232, 900, "Sidebar · logo · role nav · user card + theme", "nav"],
  [256, 20, 1160, 60, "Page title + subtitle   |   New claim · help · bell · avatar"],
]
const screens = {
  "01-login": {
    desktop: [
      [40, 30, 160, 30, "Logo"],
      [1000, 30, 120, 30, "Theme switch"],
      [160, 240, 380, 60, "Welcome back · subtitle"],
      [160, 320, 380, 52, "Work email"],
      [160, 388, 380, 52, "Password (show/hide)"],
      [160, 460, 380, 48, "Sign in", "primary"],
      [160, 530, 380, 120, "Demo accounts (4 role chips)"],
      [740, 16, 680, 868, "Showcase panel · headline · sample claim cards · 3 proof points", "accent"],
    ],
    mobile: [[16, 20, 120, 28, "Logo"], [24, 220, 327, 60, "Welcome back"], [24, 300, 327, 52, "Email"], [24, 366, 327, 52, "Password"], [24, 434, 327, 48, "Sign in", "primary"], [24, 500, 327, 120, "Demo accounts"]],
  },
  "02-my-claims": {
    desktop: [...SHELL, [256, 100, 1160, 90, "4 stats: in review · needs attention · awaiting payout · reimbursed"], [256, 210, 700, 40, "Tabs: All · Drafts · In review · Needs clarification · Closed"], [1156, 210, 260, 40, "Search"], [256, 270, 1160, 520, "Table: claim · status badge · flags (+N tooltip) · submitted · amount"]],
    mobile: [[0, 0, 375, 56, "Menu · logo · avatar", "nav"], [16, 76, 343, 50, "My claims"], [16, 140, 343, 150, "2×2 stats"], [16, 306, 343, 40, "Tabs (scroll)"], [16, 356, 343, 40, "Search"], [16, 410, 343, 330, "Claim cards"], [200, 750, 160, 48, "+ New claim (FAB)", "primary"]],
  },
  "03-claim-capture": {
    desktop: [...SHELL, [400, 100, 690, 50, "Claim title"], [400, 170, 690, 520, "Line card: category picker · amount · date · vendor · city (combobox) · nights · note · receipt drop zone · live policy hints"], [400, 706, 690, 44, "+ Add another expense"], [1110, 100, 300, 300, "Sticky summary: total (count-up) · predicted approval route · Submit · Save draft", "accent"]],
    mobile: [[0, 0, 375, 56, "Menu · logo · avatar", "nav"], [16, 76, 343, 40, "New claim"], [16, 130, 343, 50, "Title"], [16, 196, 343, 470, "Line card (category grid 3×2, fields, receipt + camera, hints)"], [0, 690, 375, 122, "Frosted bottom bar: total · route · Submit · Save draft", "accent"]],
  },
  "04-claim-detail": {
    desktop: [...SHELL, [256, 100, 900, 50, "Title · status · number · submitted"], [1180, 100, 236, 50, "Total ₹"], [256, 170, 1160, 60, "Approval chain tracker: Submitted → Manager → Auditor → Head → Approved → Paid"], [256, 250, 760, 480, "Lines: category icon · vendor · amount · outcome + flag chips · reason · receipt link"], [1036, 250, 380, 480, "Activity: comment box · audit timeline (append-only)"]],
    mobile: [[0, 0, 375, 56, "Menu · logo · avatar", "nav"], [16, 76, 343, 120, "Title · status · total"], [16, 210, 343, 60, "Chain tracker (scrolls)"], [16, 284, 343, 300, "Lines"], [16, 600, 343, 200, "Activity"]],
  },
  "05-approval-queue": {
    desktop: [...SHELL, [256, 100, 1160, 90, "4 stats: waiting · value · oldest (48h alert) · target < 30 s"], [256, 210, 1040, 40, "Flag filter pills"], [1300, 210, 116, 40, "Filters"], [256, 262, 1160, 50, "Filter panel: department · category · flag · min/max ₹ · clear"], [256, 330, 1160, 420, "Table: ☐ · claim · employee · flags · waiting bar · amount"], [560, 800, 560, 56, "Floating bulk bar: N selected · ₹ total · Bulk approve", "primary"]],
    mobile: [[0, 0, 375, 56, "Menu · logo · avatar", "nav"], [16, 76, 343, 50, "Approvals"], [16, 140, 343, 150, "2×2 stats"], [16, 306, 343, 40, "Flag pills · Filters"], [16, 360, 343, 380, "Queue cards (☐ for auditor)"]],
  },
  "06-approver-view": {
    desktop: [...SHELL, [256, 100, 1160, 110, "Header + chain tracker"], [256, 230, 360, 540, "Receipt viewer (tabs per line, zoom)", "accent"], [632, 230, 410, 540, "Lines with outcome, flags, reasons"], [1058, 230, 358, 540, "Activity + comments"], [256, 800, 1160, 64, "Decision bar: context · A/S/R shortcuts · Reject · Send back · Approve", "primary"]],
    mobile: [[0, 0, 375, 56, "Menu · logo · avatar", "nav"], [16, 76, 343, 150, "Header · total · chain"], [16, 240, 343, 360, "Receipt viewer", "accent"], [16, 612, 343, 110, "Lines (below)"], [0, 740, 375, 72, "Frosted decision bar: Reject · Send back · Approve", "primary"]],
  },
  "07-payouts": {
    desktop: [...SHELL, [256, 100, 1160, 90, "4 stats: ready · value · waiting for bank · sent"], [256, 210, 720, 560, "Eligible claims: ☐ select all · rows · Create batch"], [992, 210, 424, 560, "Batches: ref · status (Waiting for bank / Sent) · ₹ · CSV · Retry now · attempts / bank ref", "accent"]],
    mobile: [[0, 0, 375, 56, "Menu · logo · avatar", "nav"], [16, 76, 343, 60, "Payouts"], [16, 150, 343, 150, "2×2 stats"], [16, 316, 343, 260, "Eligible claims"], [16, 590, 343, 200, "Batches"]],
  },
  "08-dashboard": {
    desktop: [...SHELL, [256, 100, 120, 36, "Range"], [256, 150, 790, 100, "KPIs: pending · oldest · violations · avg approval"], [256, 266, 790, 380, "Approved spend over time (area, avg line, tooltip)", "accent"], [256, 662, 388, 200, "Oldest pending"], [658, 662, 388, 200, "Violations by flag"], [1062, 150, 354, 150, "Approval queues by level"], [1062, 316, 354, 400, "Category donut + list"], [1062, 730, 354, 130, "Spend by department"]],
    mobile: [[0, 0, 375, 56, "Menu · logo · avatar", "nav"], [16, 76, 343, 50, "Dashboard · range"], [16, 140, 343, 170, "2×2 KPIs"], [16, 324, 343, 300, "Spend chart", "accent"], [16, 640, 343, 160, "Queues · donut · lists (stacked)"]],
  },
}

const COLORS = { nav: "#eceee9", primary: "#11231a", accent: "#eef0ff" }
function html(boxes, w, h, title) {
  const items = boxes
    .map(([x, y, bw, bh, label, kind]) => {
      const bg = kind ? COLORS[kind] : "#fff"
      const fg = kind === "primary" ? "#fff" : "#3e433d"
      return `<div style="position:absolute;left:${x}px;top:${y}px;width:${bw}px;height:${bh}px;background:${bg};color:${fg};border:2px dashed ${kind === "primary" ? "#11231a" : "#9ca19a"};border-radius:10px;display:flex;align-items:center;justify-content:center;text-align:center;padding:6px;box-sizing:border-box;font:500 ${w < 500 ? 13 : 15}px/1.3 system-ui,Segoe UI,sans-serif">${label}</div>`
    })
    .join("")
  return `<!doctype html><html><body style="margin:0;background:#f6f7f5"><div style="position:relative;width:${w}px;height:${h}px;background:#f6f7f5;overflow:hidden">${items}<div style="position:absolute;right:10px;bottom:6px;font:12px system-ui;color:#9ca19a">${title}</div></div></body></html>`
}

const browser = await chromium.launch()
for (const [name, s] of Object.entries(screens)) {
  for (const [kind, w, h] of [["desktop", 1440, 900], ["mobile", 375, 812]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: kind === "mobile" ? 2 : 1 })
    await page.setContent(html(s[kind], w, h, `${name} · ${kind} wireframe`))
    await page.screenshot({ path: `${OUT}/${name}-${kind}.png` })
    await page.close()
  }
  console.log("wireframe", name)
}
await browser.close()
