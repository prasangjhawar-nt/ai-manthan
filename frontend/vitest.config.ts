import path from "path"
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  // "mock" mode loads .env.mock → VITE_MOCK=1, so component tests run against src/api/mock.ts
  mode: "mock",
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    env: { VITE_MOCK: "1" },
    include: ["src/**/*.test.{ts,tsx}"],
    reporters: ["default"],
    coverage: { provider: "v8", include: ["src/lib/**", "src/api/**", "src/components/ds/**"] },
  },
})
