import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { lazy, type ReactNode } from "react"
import type { Role } from "@/api/types"
import { homeFor, useAuth } from "@/lib/auth"
import { AppShell } from "@/components/layout/AppShell"
import LoginPage from "@/pages/LoginPage"
const ClaimsPage = lazy(() => import("@/pages/ClaimsPage"))
const ClaimFormPage = lazy(() => import("@/pages/ClaimFormPage"))
const ClaimDetailPage = lazy(() => import("@/pages/ClaimDetailPage"))
const ApprovalsPage = lazy(() => import("@/pages/ApprovalsPage"))
const PayoutsPage = lazy(() => import("@/pages/PayoutsPage"))
const DashboardPage = lazy(() => import("@/pages/DashboardPage"))
const PolicyPage = lazy(() => import("@/pages/PolicyPage"))
const DelegationPage = lazy(() => import("@/pages/DelegationPage"))
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"))

function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <>{children}</>
}

const APPROVERS: Role[] = ["MANAGER", "AUDITOR", "HEAD"]

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to={user ? homeFor(user.role) : "/login"} replace />} />
        <Route path="/claims" element={<ClaimsPage />} />
        <Route path="/claims/new" element={<ClaimFormPage />} />
        <Route path="/claims/:id/edit" element={<ClaimFormPage />} />
        <Route path="/claims/:id" element={<ClaimDetailPage />} />
        <Route path="/approvals" element={<RequireAuth roles={APPROVERS}><ApprovalsPage /></RequireAuth>} />
        <Route path="/approvals/:id" element={<RequireAuth roles={APPROVERS}><ClaimDetailPage approverView /></RequireAuth>} />
        <Route path="/payouts" element={<RequireAuth roles={["HEAD"]}><PayoutsPage /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAuth roles={["AUDITOR", "HEAD"]}><DashboardPage /></RequireAuth>} />
        <Route path="/delegation" element={<RequireAuth roles={APPROVERS}><DelegationPage /></RequireAuth>} />
        <Route path="/policy" element={<PolicyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
