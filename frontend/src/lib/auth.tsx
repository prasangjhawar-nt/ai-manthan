import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Api } from "@/api/endpoints"
import { session, setUnauthorizedHandler } from "@/api/client"
import type { Role, User } from "@/api/types"

interface AuthState {
  user: User | null
  login: (email: string, password: string) => Promise<User>
  logout: () => void
  hasRole: (...roles: Role[]) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [user, setUser] = useState<User | null>(() => (session.token ? session.user<User>() : null))

  const logout = useCallback(() => {
    session.clear()
    qc.clear()
    setUser(null)
  }, [qc])

  useEffect(() => setUnauthorizedHandler(logout), [logout])

  const login = useCallback(async (email: string, password: string) => {
    const res = await Api.login(email, password)
    session.save(res.token, res.user)
    qc.clear()
    setUser(res.user)
    return res.user
  }, [qc])

  const value = useMemo<AuthState>(
    () => ({ user, login, logout, hasRole: (...roles) => !!user && roles.includes(user.role) }),
    [user, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth outside AuthProvider")
  return ctx
}

/** Landing route per role (ST-01: "my role's home screen"). */
export function homeFor(role: Role) {
  if (role === "HEAD" || role === "AUDITOR") return "/dashboard"
  if (role === "MANAGER") return "/approvals"
  return "/claims"
}
