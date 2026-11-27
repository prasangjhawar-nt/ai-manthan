import { afterEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, homeFor, useAuth } from "./auth"
import { session } from "@/api/client"

function Probe() {
  const { user, login, logout, hasRole } = useAuth()
  return (
    <div>
      <p data-testid="who">{user ? `${user.name}:${user.role}` : "anon"}</p>
      <p data-testid="approver">{String(hasRole("MANAGER", "AUDITOR", "HEAD"))}</p>
      <button onClick={() => login("mgr.demo@expenseflow.test", "Demo@123")}>login</button>
      <button onClick={() => login("mgr.demo@expenseflow.test", "bad").catch(() => {})}>bad</button>
      <button onClick={logout}>logout</button>
    </div>
  )
}
const renderAuth = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )

afterEach(() => vi.useRealTimers())

describe("homeFor (ST-01: each role's home screen)", () => {
  it.each([
    ["EMPLOYEE", "/claims"],
    ["MANAGER", "/approvals"],
    ["AUDITOR", "/dashboard"],
    ["HEAD", "/dashboard"],
  ] as const)("%s → %s", (role, path) => expect(homeFor(role)).toBe(path))
})

describe("AuthProvider", () => {
  it("logs in, exposes role checks, and logs out clearing the session", async () => {
    const user = userEvent.setup()
    renderAuth()
    expect(screen.getByTestId("who")).toHaveTextContent("anon")
    await user.click(screen.getByText("login"))
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("Vikram Nair:MANAGER"))
    expect(screen.getByTestId("approver")).toHaveTextContent("true")
    expect(session.token).toBeTruthy()
    await user.click(screen.getByText("logout"))
    expect(screen.getByTestId("who")).toHaveTextContent("anon")
    expect(session.token).toBeNull()
  })

  it("a failed login leaves the user signed out", async () => {
    const user = userEvent.setup()
    renderAuth()
    await user.click(screen.getByText("bad"))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId("who")).toHaveTextContent("anon")
    expect(session.token).toBeNull()
  })

  it("restores the user from storage on reload", () => {
    session.save("t", { id: 5, name: "Kavya Reddy", role: "AUDITOR" }, 3600)
    renderAuth()
    expect(screen.getByTestId("who")).toHaveTextContent("Kavya Reddy:AUDITOR")
  })

  it("does not restore an expired session", () => {
    session.save("t", { id: 5, name: "Kavya Reddy", role: "AUDITOR" }, -1)
    renderAuth()
    expect(screen.getByTestId("who")).toHaveTextContent("anon")
  })

  it("signs out automatically when the token expires", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    session.save("t", { id: 5, name: "Kavya Reddy", role: "AUDITOR" }, 60)
    renderAuth()
    expect(screen.getByTestId("who")).toHaveTextContent("Kavya Reddy")
    act(() => {
      vi.advanceTimersByTime(61_000)
    })
    expect(screen.getByTestId("who")).toHaveTextContent("anon")
  })
})
