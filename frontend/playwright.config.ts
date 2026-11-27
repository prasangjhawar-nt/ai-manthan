import { defineConfig, devices } from "@playwright/test"

/**
 * E2E (README §12): Playwright TS, HTML report, desktop + 375 px projects.
 *
 *   npm run e2e                 → against the built-in mock (starts `npm run dev` on :5173, or reuses yours)
 *   BASE_URL=http://localhost:8080 npm run e2e   → against the docker gateway / real backend (no web server started)
 */
const external = process.env.BASE_URL
const baseURL = external ?? "http://localhost:5173"

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Golden flow is demoed at 375 px (README §3 / §9.5)
    { name: "mobile-375", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } } },
  ],
  webServer: external
    ? undefined
    : {
        command: "npm run dev -- --port 5173 --strictPort",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
