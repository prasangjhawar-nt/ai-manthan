import { afterEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Button, Checkbox, CountUp } from "./primitives"
import { StatusBadge } from "./domain"
import { ThemeSwitch, applyTheme } from "@/lib/theme"

describe("CountUp", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("never shows a value outside start..target, even when rAF time precedes the effect", () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal("cancelAnimationFrame", () => {})
    const { container, rerender } = render(<CountUp value={0} format={(n) => n.toFixed(2)} />)
    rerender(<CountUp value={100} format={(n) => n.toFixed(2)} />)
    const seen: number[] = []
    // first frame stamped "earlier" than any later one, then a big jump past the duration
    for (const t of [10, 5, 300, 2000]) {
      const cb = frames.shift()
      if (!cb) break
      act(() => cb(t))
      seen.push(Number(container.textContent))
    }
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0)
    expect(seen.at(-1)).toBe(100)
  })
})

describe("primitives", () => {
  it("Button shows a spinner, sets aria-busy and blocks clicks while loading", async () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const b = screen.getByRole("button", { name: "Save" })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute("aria-busy", "true")
    await userEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it("Checkbox exposes checked / mixed state to assistive tech", async () => {
    const onChange = vi.fn()
    const { rerender } = render(<Checkbox checked={false} onChange={onChange} label="Select all" />)
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }))
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(<Checkbox checked={false} indeterminate onChange={onChange} label="Select all" />)
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "mixed")
  })

  it("StatusBadge uses plain-language labels", () => {
    render(<StatusBadge status="PENDING_AUDITOR" />)
    expect(screen.getByText("With auditor")).toBeInTheDocument()
  })
})

describe("theme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme")
    localStorage.removeItem("ef.theme")
  })

  it("applyTheme sets/clears data-theme on <html>", () => {
    applyTheme("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    applyTheme("system")
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
  })

  it("ThemeSwitch persists the choice and marks the active option", async () => {
    const user = userEvent.setup()
    render(<ThemeSwitch />)
    expect(screen.getByRole("radio", { name: "System theme" })).toHaveAttribute("aria-checked", "true")
    await user.click(screen.getByRole("radio", { name: "Dark theme" }))
    expect(localStorage.getItem("ef.theme")).toBe("dark")
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(screen.getByRole("radio", { name: "Dark theme" })).toHaveAttribute("aria-checked", "true")
    await user.click(screen.getByRole("radio", { name: "System theme" }))
    expect(localStorage.getItem("ef.theme")).toBeNull()
  })
})
