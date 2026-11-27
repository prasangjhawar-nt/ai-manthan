import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * ExpenseFlow mark: a receipt (serrated bottom edge) whose last line turns into an
 * arrow that leaves the paper — a claim flowing out to payout. The arrow turns mint
 * once it is outside the receipt: money on its way.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "")
  const receipt = "M9 6h9a2 2 0 0 1 2 2v17l-2.17-1.5-2.16 1.5-2.17-1.5-2.17 1.5-2.16-1.5L7 25V8a2 2 0 0 1 2-2z"
  const arrow = "M10.2 18.7H24.6M21.4 15.5l3.2 3.2-3.2 3.2"
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <clipPath id={`r-${id}`}>
          <path d={receipt} />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="9" fill="var(--obsidian, #11231a)" />
      <path d={receipt} fill="#fff" />
      <rect x="10.2" y="10" width="6.8" height="1.9" rx=".95" fill="var(--obsidian, #11231a)" />
      <rect x="10.2" y="13.6" width="4.2" height="1.9" rx=".95" fill="var(--obsidian, #11231a)" opacity=".45" />
      <path d={arrow} fill="none" stroke="#7fdcab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={arrow} fill="none" stroke="var(--obsidian, #11231a)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#r-${id})`} />
    </svg>
  )
}

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span className="text-[18px] leading-none font-semibold tracking-[-0.035em] text-ink">
        Expense<span className="text-ink-3">Flow</span>
      </span>
    </div>
  )
}
