import path from "path"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const apiTarget = env.VITE_API_TARGET || "http://localhost:8080"
  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    // Playwright writes traces/videos under e2e/ — don't let them trigger page reloads mid-test.
    watch: { ignored: ["**/e2e/**", "**/coverage/**"] },
    proxy: {
      // Real backend / nginx gateway by default. `npm run dev:prism` -> Prism on 4010, `npm run dev:mock` -> in-browser mock.
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        // When nothing answers, return a readable problem+json instead of a bare 502.
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            const r = res as import("http").ServerResponse
            if (r.headersSent || typeof r.writeHead !== "function") return
            r.writeHead(502, { "Content-Type": "application/problem+json" })
            r.end(
              JSON.stringify({
                title: "Backend not reachable",
                status: 502,
                detail: `Nothing is answering at ${apiTarget}. Start the backend (backend/run-local.ps1), or use "npm run dev", which runs the built-in mock.`,
              }),
            )
          })
        },
      },
    },
  },
}
})
