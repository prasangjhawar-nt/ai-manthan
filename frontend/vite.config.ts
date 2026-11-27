import path from "path"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Real backend / nginx gateway by default. `npm run dev:prism` -> Prism on 4010, `npm run dev:mock` -> in-browser mock.
      "/api": {
        target: env.VITE_API_TARGET || "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
}
})
