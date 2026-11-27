import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { toast } from "sonner"
import { Amount, EmptyState, ErrorState, FlagList, OutcomeChip, PageHeader, Segmented, CategoryIcon } from "./domain"
import { CityCombobox } from "./combobox"
import { Modal } from "./dialog"
import { Field, Input } from "./primitives"
import { Logo } from "./logo"
import { ApiError } from "@/api/client"
import { toastError } from "@/api/hooks"

describe("Amount", () => {
  it("shows ₹, Indian grouping and muted decimals", () => {
    const { container } = render(<Amount value={145000} />)
    expect(container.textContent).toBe("₹1,45,000.00")
  })
  it("renders a dash for missing values", () => {
    const { container } = render(<Amount value={null} />)
    expect(container.textContent).toBe("₹—")
  })
})

describe("chips", () => {
  it("FlagList shows a dash when clean and all flags when within max", () => {
    const { rerender } = render(<FlagList flags={[]} />)
    expect(screen.getByText("—")).toBeInTheDocument()
    rerender(<FlagList flags={["WEEKEND", "DUPLICATE"]} />)
    expect(screen.getByText("Weekend")).toBeInTheDocument()
    expect(screen.getByText("Duplicate")).toBeInTheDocument()
    expect(screen.queryByTestId("flags-more")).toBeNull()
  })
  it.each([
    [null, "Not checked"],
    ["AUTO_APPROVE", "Clean"],
    ["ROUTE", "Routed"],
    ["AUTO_REJECT", "Auto-rejected"],
  ] as const)("OutcomeChip %s → %s", (o, label) => {
    render(<OutcomeChip outcome={o} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
  it("CategoryIcon has a title for hover", () => {
    render(<CategoryIcon category="LOCAL_CAB" />)
    expect(screen.getByTitle("Local cab")).toBeInTheDocument()
  })
})

describe("states", () => {
  it("ErrorState shows the problem, its correlation id and a retry", async () => {
    const retry = vi.fn()
    render(<ErrorState error={new ApiError({ title: "Server error", status: 500, detail: "Boom", correlationId: "cid-42" })} onRetry={retry} />)
    expect(screen.getByRole("alert")).toHaveTextContent("Server error")
    expect(screen.getByText("Ref cid-42")).toBeInTheDocument()
    await userEvent.click(screen.getByTestId("retry"))
    expect(retry).toHaveBeenCalled()
  })
  it("ErrorState for 404 says Not found and offers no retry", () => {
    render(<ErrorState error={new ApiError({ title: "Not found", status: 404, detail: "Claim not found" })} onRetry={() => {}} />)
    expect(screen.getByText("Not found")).toBeInTheDocument()
    expect(screen.queryByTestId("retry")).toBeNull()
  })
  it("ErrorState handles non-API errors", () => {
    render(<ErrorState error={new Error("x")} />)
    expect(screen.getByText("Couldn't load this")).toBeInTheDocument()
  })
  it("EmptyState renders title, body and action", () => {
    render(<EmptyState icon={<span />} title="No claims yet" body="Create one" action={<button>New</button>} />)
    expect(screen.getByText("No claims yet")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument()
  })
  it("PageHeader renders title, subtitle and actions", () => {
    render(<PageHeader title="Payouts" sub="Bundle claims" actions={<button>Go</button>} />)
    expect(screen.getByRole("heading", { level: 1, name: "Payouts" })).toBeInTheDocument()
    expect(screen.getByText("Bundle claims")).toBeInTheDocument()
  })
})

describe("Segmented", () => {
  it("is a tablist; clicking a tab selects it and shows counts", async () => {
    function H() {
      const [v, setV] = useState<"a" | "b">("a")
      return <Segmented value={v} onChange={setV} options={[{ value: "a", label: "All", count: 5 }, { value: "b", label: "Drafts", count: 1 }]} />
    }
    render(<H />)
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true")
    await userEvent.click(screen.getByRole("tab", { name: /Drafts/ }))
    expect(screen.getByRole("tab", { name: /Drafts/ })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: /All/ })).toHaveTextContent("5")
  })
})

describe("CityCombobox", () => {
  function H({ cities = ["Mumbai", "Delhi", "Bengaluru"] }: { cities?: string[] }) {
    const [v, setV] = useState("")
    return (
      <div>
        <CityCombobox value={v} onChange={setV} cities={cities} tier1Hint="₹6,000/night" otherHint="₹4,000/night" testId="city" />
        <p data-testid="val">{v}</p>
        <button>outside</button>
      </div>
    )
  }
  it("opens on focus with grouped hints, closes on Escape", async () => {
    const user = userEvent.setup()
    render(<H />)
    await user.click(screen.getByTestId("city"))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    expect(screen.getByText("₹6,000/night")).toBeInTheDocument()
    expect(screen.getByTestId("city")).toHaveAttribute("aria-expanded", "true")
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("listbox")).toBeNull()
  })
  it("arrow keys move the active option (aria-activedescendant) and Enter picks it", async () => {
    const user = userEvent.setup()
    render(<H />)
    await user.click(screen.getByTestId("city"))
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}{ArrowDown}{Enter}")
    expect(screen.getByTestId("val")).toHaveTextContent("Bengaluru")
  })
  it("prefers prefix matches and offers a custom city with the 'other' hint", async () => {
    const user = userEvent.setup()
    render(<H cities={["Pune", "Kanpur"]} />)
    await user.type(screen.getByTestId("city"), "pu")
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Pune", "Kanpur", "Use “pu”₹4,000/night"])
  })
  it("closes when clicking outside", async () => {
    const user = userEvent.setup()
    render(<H />)
    await user.click(screen.getByTestId("city"))
    await user.click(screen.getByText("outside"))
    expect(screen.queryByRole("listbox")).toBeNull()
  })
  it("clicking an option selects it", async () => {
    const user = userEvent.setup()
    render(<H />)
    await user.click(screen.getByTestId("city"))
    await user.click(screen.getByRole("option", { name: /Delhi/ }))
    expect(screen.getByTestId("val")).toHaveTextContent("Delhi")
  })
})

describe("Modal", () => {
  it("is a labelled dialog that closes with Escape and the close button", async () => {
    const user = userEvent.setup()
    function H() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <p data-testid="state">{String(open)}</p>
          <button onClick={() => setOpen(true)}>open</button>
          <Modal open={open} onOpenChange={setOpen} title="Reject claim" description="This is final.">
            <input aria-label="Reason" />
          </Modal>
        </>
      )
    }
    render(<H />)
    expect(await screen.findByRole("dialog", { name: "Reject claim" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.getByTestId("state")).toHaveTextContent("false")
    await user.click(screen.getByText("open"))
    await user.click(await screen.findByRole("button", { name: "Close" }))
    expect(screen.getByTestId("state")).toHaveTextContent("false")
  })
})

describe("Field", () => {
  it("associates the label and announces errors", () => {
    render(
      <Field label="Vendor" htmlFor="v" error="Who did you pay?">
        <Input id="v" aria-invalid />
      </Field>,
    )
    expect(screen.getByLabelText("Vendor")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Who did you pay?")
  })
  it("shows a hint when there is no error and marks optional fields", () => {
    render(
      <Field label="Note" htmlFor="n" hint="Purpose" optional>
        <Input id="n" />
      </Field>,
    )
    expect(screen.getByText("Purpose")).toBeInTheDocument()
    expect(screen.getByText("optional")).toBeInTheDocument()
  })
})

describe("Logo", () => {
  it("renders the wordmark", () => {
    render(<Logo />)
    expect(screen.getByText("ExpenseFlow")).toBeInTheDocument()
  })
})

describe("toastError", () => {
  it("shows the problem title, detail and correlation id", () => {
    const spy = vi.spyOn(toast, "error").mockImplementation(() => 1)
    toastError(new ApiError({ title: "Forbidden", status: 403, detail: "You can't approve your own claim", correlationId: "c1" }))
    expect(spy).toHaveBeenCalledWith("Forbidden", { description: "You can't approve your own claim · Ref c1" })
    spy.mockRestore()
  })
  it("429 shows a 'slow down' warning", () => {
    const spy = vi.spyOn(toast, "warning").mockImplementation(() => 1)
    toastError(new ApiError({ title: "Too many", status: 429 }))
    expect(spy).toHaveBeenCalledWith("Slow down", expect.anything())
    spy.mockRestore()
  })
  it("unknown errors use the fallback text", () => {
    const spy = vi.spyOn(toast, "error").mockImplementation(() => 1)
    toastError(new Error("?"), "Couldn't save")
    expect(spy).toHaveBeenCalledWith("Couldn't save")
    spy.mockRestore()
  })
})
