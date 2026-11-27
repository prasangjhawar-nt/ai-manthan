import type { ReactElement, ReactNode } from "react"
import { Tooltip as T } from "@base-ui/react/tooltip"
import { cn } from "@/lib/utils"

/**
 * Themed tooltip: white surface, hairline border, soft shadow, small arrow.
 * `children` must be a single element that can hold a ref (it becomes the trigger).
 */
export function Tooltip({ content, children, side = "top", className, delay = 120 }: { content: ReactNode; children: ReactElement; side?: "top" | "bottom" | "left" | "right"; className?: string; delay?: number }) {
  return (
    <T.Root>
      <T.Trigger delay={delay} closeDelay={60} render={children} />
      <T.Portal>
        <T.Positioner side={side} sideOffset={8} className="z-[60]">
          <T.Popup
            className={cn(
              "origin-[var(--transform-origin)] rounded-[10px] border border-line bg-surface px-2.5 py-2 text-[12px] text-ink-2 shadow-md transition-[opacity,transform] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              className,
            )}
          >
            <T.Arrow className="data-[side=bottom]:top-[-7px] data-[side=top]:bottom-[-7px] data-[side=top]:rotate-180 data-[side=left]:right-[-11px] data-[side=left]:rotate-90 data-[side=right]:left-[-11px] data-[side=right]:-rotate-90">
              <svg width="14" height="7" viewBox="0 0 14 7" aria-hidden>
                <path d="M0 7 L7 0 L14 7" fill="var(--surface)" />
                <path d="M0 7 L7 0 L14 7" fill="none" stroke="var(--line)" />
              </svg>
            </T.Arrow>
            {content}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  )
}

export const TooltipProvider = T.Provider
