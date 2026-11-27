import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Tone } from "@/lib/format"
import { initials } from "@/lib/format"

/* ------------------------------------------------------------------ Button */
export const buttonStyles = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium outline-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-cobalt/40 focus-visible:ring-offset-1 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-obsidian text-white shadow-sm hover:bg-obsidian-hover",
        outline: "border border-line-strong bg-surface text-ink shadow-xs hover:border-ink-4 hover:bg-surface-2",
        soft: "bg-surface-3 text-ink hover:bg-[#e2e5df]",
        ghost: "text-ink-2 hover:bg-surface-3 hover:text-ink",
        danger: "bg-danger text-white shadow-sm hover:bg-[#a83124]",
        "danger-soft": "border border-transparent bg-danger-soft text-danger hover:border-danger/25",
        positive: "bg-positive text-white shadow-sm hover:bg-[#0c7a54]",
        link: "h-auto px-0 text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink",
      },
      size: {
        sm: "h-8 rounded-[9px] px-3 text-[13px] [&_svg]:size-3.5",
        md: "h-9 rounded-control px-3.5 text-[13.5px] [&_svg]:size-4",
        lg: "h-11 rounded-[12px] px-5 text-[14.5px] [&_svg]:size-[18px]",
        icon: "size-9 rounded-control [&_svg]:size-[18px]",
        "icon-sm": "size-8 rounded-[9px] [&_svg]:size-4",
      },
      caps: { true: "text-[12px] uppercase tracking-[0.06em]" },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
)

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonStyles> & { loading?: boolean }

export function Button({ className, variant, size, caps, loading, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonStyles({ variant, size, caps }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="animate-spin" />}
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ Card */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-card border border-line bg-surface", className)} {...props} />
}

export function CardHeader({ title, action, className, sub }: { title: ReactNode; action?: ReactNode; className?: string; sub?: ReactNode }) {
  return (
    <header className={cn("flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5", className)}>
      <div className="min-w-0">
        <h2 className="eyebrow truncate">{title}</h2>
        {sub && <p className="mt-0.5 truncate text-xs text-ink-3">{sub}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  )
}

/* ------------------------------------------------------------------ Badge / chips */
const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  warning: "bg-warning-soft text-warning",
  positive: "bg-positive-soft text-positive",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  violet: "bg-violet-soft text-violet",
  ink: "bg-ink text-white",
}

export function Badge({ tone = "neutral", dot, pulse, className, children }: { tone?: Tone; dot?: boolean; pulse?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium leading-none", toneClasses[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full bg-current", pulse && "animate-pulse-dot")} aria-hidden />}
      {children}
    </span>
  )
}

export function Chip({ tone = "neutral", icon, className, children }: { tone?: Tone; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 text-[11.5px] font-medium leading-none [&_svg]:size-3", toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ Form controls */
const control =
  "w-full rounded-control border border-line-strong bg-surface text-[14px] text-ink shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-4 hover:border-ink-4 focus:border-cobalt focus:ring-3 focus:ring-cobalt/12 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3 aria-invalid:border-danger aria-invalid:ring-danger/12"

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-10 px-3", className)} {...props} />
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 resize-y px-3 py-2.5 leading-relaxed", className)} {...props} />
}
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(control, "h-10 appearance-none pr-9 pl-3", className)} {...props}>
        {children}
      </select>
      <svg className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-3" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

export function Field({ label, htmlFor, error, hint, className, children, optional }: { label: string; htmlFor?: string; error?: string; hint?: ReactNode; className?: string; children: ReactNode; optional?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink-2">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-4">optional</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="animate-fade text-[12px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-ink-3">{hint}</p>
      ) : null}
    </div>
  )
}

export function Checkbox({ checked, indeterminate, onChange, label, className, ...rest }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; label: string; className?: string } & Omit<ComponentProps<"button">, "onChange">) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        "grid size-[18px] place-items-center rounded-[5px] border transition-colors duration-150",
        checked || indeterminate ? "border-obsidian bg-obsidian text-white" : "border-line-strong bg-surface hover:border-ink-3",
        className,
      )}
      {...rest}
    >
      {indeterminate ? (
        <span className="h-[2px] w-2 rounded bg-white" />
      ) : (
        checked && (
          <svg viewBox="0 0 12 12" className="size-3 animate-pop" aria-hidden>
            <path d="M2.5 6.2l2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      )}
    </button>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-2 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition-colors duration-200", checked ? "bg-obsidian" : "bg-line-strong")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out", checked && "translate-x-4")} />
      </button>
      {label}
    </label>
  )
}

/* ------------------------------------------------------------------ Misc */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />
}

const avatarHues = ["#dfe6dc", "#e6e1f6", "#f6e6d6", "#dcecf3", "#f3dfdc", "#ece8cf"]
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const hue = avatarHues[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % avatarHues.length]
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-ink-2", className)}
      style={{ width: size, height: size, background: hue, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-3">{children}</kbd>
}

/** Animated number that eases toward its target — used on KPIs and totals. */
export function CountUp({ value, format = (n) => String(Math.round(n)), duration = 700 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const first = useRef(true)
  useEffect(() => {
    const start = first.current ? 0 : from.current
    first.current = false
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value)
      from.current = value
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const e = 1 - Math.pow(1 - p, 4)
      setShown(start + (value - start) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{format(shown)}</>
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-line", className)} />
}
