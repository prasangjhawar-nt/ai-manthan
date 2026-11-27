import { Suspense, useEffect, useState, type ReactNode } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { LayoutGrid, ReceiptText, Inbox, Landmark, ScrollText, UserRoundCog, LogOut, Menu, Plus, HelpCircle, Bell } from "lucide-react"
import type { Role } from "@/api/types"
import { useAuth } from "@/lib/auth"
import { ROLE_LABEL } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Avatar, Button } from "@/components/ds/primitives"
import { Drawer } from "@/components/ds/dialog"
import { useQueue } from "@/api/hooks"

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 24 24" className="size-[22px] text-obsidian" aria-hidden>
        <rect x="2" y="2" width="9" height="9" rx="2.4" fill="currentColor" />
        <rect x="13" y="7.5" width="9" height="9" rx="2.4" fill="currentColor" opacity=".45" />
        <rect x="2" y="13" width="9" height="9" rx="2.4" fill="currentColor" />
      </svg>
      <span className="text-[19px] font-semibold tracking-[-0.03em] text-ink">ExpenseFlow</span>
    </div>
  )
}

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutGrid
  roles: Role[]
  badge?: "queue"
}
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid, roles: ["AUDITOR", "HEAD"] },
  { to: "/approvals", label: "Approvals", icon: Inbox, roles: ["MANAGER", "AUDITOR", "HEAD"], badge: "queue" },
  { to: "/claims", label: "My claims", icon: ReceiptText, roles: ["EMPLOYEE", "MANAGER", "AUDITOR", "HEAD"] },
  { to: "/payouts", label: "Payouts", icon: Landmark, roles: ["HEAD"] },
  { to: "/delegation", label: "Delegation", icon: UserRoundCog, roles: ["MANAGER", "AUDITOR", "HEAD"] },
  { to: "/policy", label: "Policy", icon: ScrollText, roles: ["EMPLOYEE", "MANAGER", "AUDITOR", "HEAD"] },
]

function QueueCount() {
  const { data } = useQueue({})
  const n = data?.totalElements ?? 0
  if (!n) return null
  return <span className="num ml-auto rounded-full bg-obsidian px-1.5 text-[11px] leading-[18px] font-medium text-white">{n}</span>
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth()
  if (!user) return null
  const items = NAV.filter((n) => n.roles.includes(user.role))
  return (
    <div className="flex h-full flex-col px-3 pt-5 pb-4">
      <Logo className="mb-8 px-2.5" />
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {items.map((item, i) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            data-testid={`nav-${item.to.slice(1)}`}
            style={{ "--i": i } as React.CSSProperties}
            className={({ isActive }) =>
              cn(
                "stagger group flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-[13.5px] transition-colors duration-150",
                isActive ? "bg-surface-3 font-medium text-ink shadow-[inset_0_0_0_1px_rgb(0_0_0/0.03)]" : "text-ink-2 hover:bg-surface-3/60 hover:text-ink",
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn("size-[17px] transition-colors", isActive ? "text-ink" : "text-ink-3 group-hover:text-ink-2")} strokeWidth={1.8} />
                {item.label}
                {item.badge === "queue" && <QueueCount />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto">
        <div className="rounded-[14px] border border-line bg-surface p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={user.name} size={34} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{user.name}</p>
              <p className="truncate text-[11.5px] text-ink-3">
                {ROLE_LABEL[user.role]} · {user.departmentName}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="mt-2 w-full justify-start text-ink-3" onClick={logout} data-testid="logout">
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Top bar inside the workspace — title area is owned by each page; this holds global actions. */
function TopActions() {
  const { user } = useAuth()
  const nav = useNavigate()
  if (!user) return null
  return (
    <div className="flex items-center gap-2">
      <Button variant="primary" size="md" onClick={() => nav("/claims/new")} data-testid="new-claim" className="hidden sm:inline-flex">
        <Plus /> New claim
      </Button>
      <Button variant="outline" size="icon" aria-label="Policy help" onClick={() => nav("/policy")} className="hidden md:inline-flex">
        <HelpCircle />
      </Button>
      <Button variant="outline" size="icon" aria-label="Notifications" className="hidden md:inline-flex">
        <Bell />
      </Button>
      <Avatar name={user.name} size={36} className="ring-2 ring-surface" />
    </div>
  )
}

export function AppShell() {
  const [drawer, setDrawer] = useState(false)
  const loc = useLocation()
  useEffect(() => setDrawer(false), [loc.pathname])
  useEffect(() => {
    document.getElementById("workspace")?.scrollTo({ top: 0 })
  }, [loc.pathname])

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-[232px] shrink-0 lg:block">
        <SidebarNav />
      </aside>
      <Drawer open={drawer} onOpenChange={setDrawer}>
        <SidebarNav onNavigate={() => setDrawer(false)} />
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col lg:py-3 lg:pr-3">
        <main
          id="workspace"
          className="scroll-thin relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface lg:rounded-panel lg:border lg:border-line lg:shadow-[0_1px_2px_rgb(17_35_26/0.04)]"
        >
          {/* Mobile bar */}
          <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur-md lg:hidden">
            <button className="-ml-2 grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-surface-3" onClick={() => setDrawer(true)} aria-label="Open menu" data-testid="menu">
              <Menu className="size-5" />
            </button>
            <Logo className="scale-90" />
            <TopActions />
          </div>
          <div key={loc.pathname} className="flex min-h-0 flex-1 flex-col">
            <Suspense fallback={<div className="m-6 h-1 w-24 skeleton" aria-busy />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}

/** Desktop actions are rendered inside each page header so they align with the title (like the reference). */
export function HeaderActions({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <div className="hidden lg:flex">
        <TopActions />
      </div>
    </div>
  )
}
