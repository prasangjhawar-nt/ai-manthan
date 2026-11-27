import type { ReactNode } from "react"
import { Dialog as D } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/** Centered modal on desktop, bottom sheet on mobile. Keyboard-usable (focus trap, Esc). */
export function Modal({ open, onOpenChange, title, description, children, footer, className }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-50 bg-[#0d1410]/35 backdrop-blur-[3px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <D.Popup
          className={cn(
            "fixed z-50 flex max-h-[88dvh] w-full flex-col bg-surface shadow-lg outline-none transition-[opacity,transform] duration-300 ease-out-quint",
            "inset-x-0 bottom-0 rounded-t-[20px] data-[ending-style]:translate-y-6 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-6 data-[starting-style]:opacity-0",
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[18px] sm:data-[ending-style]:translate-y-[-48%] sm:data-[ending-style]:scale-[0.98] sm:data-[starting-style]:translate-y-[-48%] sm:data-[starting-style]:scale-[0.98]",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <D.Title className="text-[16px] font-semibold tracking-[-0.01em]">{title}</D.Title>
              {description && <D.Description className="mt-1 text-[13px] text-ink-3">{description}</D.Description>}
            </div>
            <D.Close className="-mt-1 -mr-1 grid size-8 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          {children && <div className="scroll-thin overflow-y-auto px-5 pt-4 pb-1">{children}</div>}
          {footer && <div className="flex flex-col-reverse gap-2 px-5 pt-4 pb-5 sm:flex-row sm:justify-end">{footer}</div>}
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}

/** Side drawer (mobile navigation). */
export function Drawer({ open, onOpenChange, children }: { open: boolean; onOpenChange: (o: boolean) => void; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-50 bg-[#0d1410]/30 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <D.Popup className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-canvas shadow-lg outline-none transition-transform duration-300 ease-out-quint data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full">
          <D.Title className="sr-only">Navigation</D.Title>
          {children}
        </D.Popup>
      </D.Portal>
    </D.Root>
  )
}
