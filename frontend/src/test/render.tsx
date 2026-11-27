import type { ReactElement } from "react"
import { render } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider } from "@/lib/auth"
import { TooltipProvider } from "@/components/ds/tooltip"
import { Api } from "@/api/endpoints"
import { session } from "@/api/client"

/** Signs in against the mock so pages render as that user. */
export async function signIn(email = "emp.demo@expenseflow.test") {
  const r = await Api.login(email, "Demo@123")
  session.save(r.token, r.user, r.expiresInSeconds)
  return r.user
}

export function renderAt(path: string, routes: { path: string; element: ReactElement }[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const user = userEvent.setup()
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <TooltipProvider delay={0}>
            <Routes>
              {routes.map((r) => (
                <Route key={r.path} path={r.path} element={r.element} />
              ))}
              <Route path="*" element={<div data-testid="landed" />} />
            </Routes>
          </TooltipProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { user, ...utils }
}
