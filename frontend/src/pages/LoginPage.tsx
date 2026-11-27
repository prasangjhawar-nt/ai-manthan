import { useState } from "react"
import { toast } from "sonner"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useLocation, useNavigate } from "react-router-dom"
import { ArrowRight, Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react"
import { homeFor, useAuth } from "@/lib/auth"
import { ApiError } from "@/api/client"
import { Button, Field, Input } from "@/components/ds/primitives"
import { Logo } from "@/components/layout/AppShell"
import { StatusBadge, FlagChip, Amount } from "@/components/ds/domain"
import { cn } from "@/lib/utils"

const schema = z.object({
  email: z.string().trim().min(1, "Enter your work email").email("That doesn't look like an email"),
  password: z.string().min(1, "Enter your password"),
})
type Form = z.infer<typeof schema>

const DEMO = [
  { role: "Employee", email: "emp.demo@expenseflow.test" },
  { role: "Manager", email: "mgr.demo@expenseflow.test" },
  { role: "Auditor", email: "auditor.demo@expenseflow.test" },
  { role: "Finance head", email: "head.demo@expenseflow.test" },
]

export default function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [show, setShow] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const { register, handleSubmit, setValue, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } })

  const onSubmit = handleSubmit(async (v) => {
    setServerError(null)
    try {
      const user = await login(v.email, v.password)
      // A static mock (Prism) ignores the email and always returns the same example user.
      if (user.email.toLowerCase() !== v.email.trim().toLowerCase()) {
        toast.warning(`Signed in as ${user.name}, not ${v.email}`, {
          description: "The API is a static mock (Prism) that always returns one example user. Use `npm run dev:mock` or the real backend to switch personas.",
          duration: 10000,
        })
      }
      const from = (loc.state as { from?: string } | null)?.from
      nav(from && from !== "/" ? from : homeFor(user.role), { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setServerError("Too many attempts. Wait a minute and try again.")
      else if (e instanceof ApiError && e.status === 401) setServerError("Email or password is incorrect.")
      else if (e instanceof ApiError && (e.status === 0 || e.status >= 502)) setServerError(e.problem.detail ?? "The server isn't reachable. Start the backend or run npm run dev:mock.")
      else setServerError(e instanceof ApiError ? (e.problem.detail ?? e.message) : "Can't sign in right now.")
    }
  })

  const fill = (email: string) => {
    setValue("email", email, { shouldValidate: true })
    setValue("password", "Demo@123", { shouldValidate: true })
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Form */}
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <div className="stagger" style={{ "--i": 0 } as React.CSSProperties}>
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em]">Welcome back</h1>
            <p className="mt-2 text-[14px] text-ink-3">Sign in to submit, review and pay expense claims.</p>
          </div>

          <form onSubmit={onSubmit} noValidate className="stagger mt-8 flex flex-col gap-4" style={{ "--i": 1 } as React.CSSProperties}>
            <Field label="Work email" htmlFor="email" error={formState.errors.email?.message}>
              <Input id="email" type="email" autoComplete="username" placeholder="you@company.com" aria-invalid={!!formState.errors.email} data-testid="login-email" {...register("email")} />
            </Field>
            <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
              <div className="relative">
                <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" className="pr-10" aria-invalid={!!formState.errors.password} data-testid="login-password" {...register("password")} />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink" aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            {serverError && (
              <div role="alert" aria-live="polite" className="animate-rise rounded-control border border-danger/20 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
                {serverError}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting} className="mt-1 w-full" data-testid="login-submit">
              Sign in <ArrowRight />
            </Button>
          </form>

          <div className="stagger mt-8" style={{ "--i": 2 } as React.CSSProperties}>
            <div className="flex items-center gap-3 text-[11.5px] tracking-[0.06em] text-ink-4 uppercase">
              <span className="h-px flex-1 bg-line" /> Demo accounts <span className="h-px flex-1 bg-line" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => fill(d.email)}
                  data-testid={`demo-${d.role.split(" ")[0].toLowerCase()}`}
                  className="group rounded-control border border-line bg-surface px-3 py-2 text-left transition-[border-color,background-color,transform] duration-150 hover:border-line-strong hover:bg-surface-2 active:scale-[0.98]"
                >
                  <span className="block text-[13px] font-medium">{d.role}</span>
                  <span className="block truncate text-[11.5px] text-ink-3">{d.email.split("@")[0]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="flex items-center gap-1.5 text-[12px] text-ink-4">
          <ShieldCheck className="size-3.5" /> Synthetic demo data only · Team 45 · AI Manthan 2026
        </p>
      </div>

      {/* Showcase */}
      <div className="relative hidden overflow-hidden p-3 lg:block">
        <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-[24px] bg-obsidian p-10 text-white">
          <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "22px 22px" }} />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/80">
              <Sparkles className="size-3.5" /> Policy engine checks every line
            </span>
            <h2 className="mt-5 max-w-md text-[34px] leading-[1.1] font-semibold tracking-[-0.03em]">From receipt to bank in days, not weeks.</h2>
            <p className="mt-3 max-w-sm text-[14px] text-white/60">Rules flag what needs a human. Everything else flows straight through to payout.</p>
          </div>

          <div className="relative mx-auto w-full max-w-[420px]">
            <FloatCard className="rotate-[-2deg]" delay={0}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[11px] text-ink-3">EXP-2026-000123</p>
                  <p className="mt-0.5 text-[14px] font-medium text-ink">Mumbai client visit</p>
                </div>
                <StatusBadge status="PENDING_MANAGER" />
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div className="flex gap-1">
                  <FlagChip flag="OVER_LIMIT" />
                  <FlagChip flag="WEEKEND" />
                </div>
                <Amount value={30500} size="lg" />
              </div>
            </FloatCard>
            <FloatCard className="mt-3 ml-10 rotate-[1.5deg]" delay={1}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[11px] text-ink-3">PB-20261127-001</p>
                  <p className="mt-0.5 text-[14px] font-medium text-ink">Payout batch · 2 claims</p>
                </div>
                <StatusBadge status="PAID" />
              </div>
            </FloatCard>
          </div>

          <div className="relative grid grid-cols-3 gap-6 border-t border-white/10 pt-6">
            {[
              ["< 30s", "per approval decision"],
              ["3 levels", "manager → auditor → head"],
              ["100%", "append-only audit trail"],
            ].map(([a, b]) => (
              <div key={a}>
                <p className="text-[20px] font-semibold tracking-[-0.02em]">{a}</p>
                <p className="mt-0.5 text-[12px] text-white/50">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function FloatCard({ children, className, delay }: { children: React.ReactNode; className?: string; delay: number }) {
  return (
    <div className={cn("stagger rounded-[16px] bg-surface p-4 text-ink shadow-lg", className)} style={{ "--i": 3 + delay * 2 } as React.CSSProperties}>
      {children}
    </div>
  )
}
