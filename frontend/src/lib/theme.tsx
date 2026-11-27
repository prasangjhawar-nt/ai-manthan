import { useCallback, useEffect, useState } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"

export type ThemePref = "light" | "dark" | "system"
const KEY = "ef.theme"

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : "system"
  } catch {
    return "system"
  }
}

const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false

/** Applies the preference to <html data-theme> and the browser chrome colour. */
export function applyTheme(pref: ThemePref, animate = false) {
  const root = document.documentElement
  if (animate) {
    root.classList.add("theme-switching")
    window.setTimeout(() => root.classList.remove("theme-switching"), 300)
  }
  if (pref === "system") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", pref)
  const dark = pref === "dark" || (pref === "system" && systemDark())
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0d100e" : "#e9ebe7")
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read)
  const set = useCallback((p: ThemePref) => {
    try {
      if (p === "system") localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      /* private mode: still applies for this page */
    }
    applyTheme(p, true)
    setPref(p)
  }, [])
  useEffect(() => {
    applyTheme(pref)
    if (pref !== "system") return
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)")
    const on = () => applyTheme("system", true)
    mq?.addEventListener("change", on)
    return () => mq?.removeEventListener("change", on)
  }, [pref])
  return { pref, set }
}

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
]

/** Compact three-way switch with a sliding thumb. */
export function ThemeSwitch({ className }: { className?: string }) {
  const { pref, set } = useTheme()
  const idx = OPTIONS.findIndex((o) => o.value === pref)
  return (
    <div role="radiogroup" aria-label="Theme" className={cn("relative grid grid-cols-3 rounded-[10px] border border-line bg-surface-2 p-[3px]", className)} data-testid="theme-switch">
      <span
        aria-hidden
        className="absolute top-[3px] bottom-[3px] left-[3px] w-[calc((100%-6px)/3)] rounded-[7px] bg-surface shadow-sm ring-1 ring-line transition-transform duration-300 ease-out-quint"
        style={{ transform: `translateX(${idx * 100}%)` }}
      />
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          aria-label={`${label} theme`}
          title={label}
          onClick={() => set(value)}
          data-testid={`theme-${value}`}
          className={cn("relative z-10 grid h-7 place-items-center rounded-[7px] transition-colors duration-200", pref === value ? "text-ink" : "text-ink-3 hover:text-ink-2")}
        >
          <Icon className="size-[15px]" strokeWidth={1.9} />
        </button>
      ))}
    </div>
  )
}
