import { cn } from "@/lib/utils"

/** ExpenseFlow mark — three stepped blocks in ink, no background tile. */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={cn("shrink-0 text-ink", className)} aria-hidden>
      <rect x="2" y="2" width="9" height="9" rx="2.4" fill="currentColor" />
      <rect x="13" y="7.5" width="9" height="9" rx="2.4" fill="currentColor" opacity=".45" />
      <rect x="2" y="13" width="9" height="9" rx="2.4" fill="currentColor" />
    </svg>
  )
}

export function Logo({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span className="text-[19px] font-semibold tracking-[-0.03em] text-ink">ExpenseFlow</span>
    </div>
  )
}
