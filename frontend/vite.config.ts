import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // Switch 4010 -> 8080 at minute 80 (Step 5 integration check)
      "/api": {
        target: "http://localhost:4010",
        changeOrigin: true,
      },
    },
  },
})