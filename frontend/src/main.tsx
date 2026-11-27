import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import "./index.css"
import App from "./App.tsx"
import { AuthProvider } from "./lib/auth"
import { ApiError } from "./api/client"
import { TooltipProvider } from "./components/ds/tooltip"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <TooltipProvider delay={120}>
            <App />
          </TooltipProvider>
          <Toaster
            position="bottom-right"
            gap={8}
            toastOptions={{
              classNames: {
                toast: "!rounded-[14px] !border-line !bg-surface !shadow-lg !font-sans !text-ink",
                description: "!text-ink-3",
              },
            }}
          />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
