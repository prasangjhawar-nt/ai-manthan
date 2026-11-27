import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, MapPin, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  id?: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  /** Known cities (tier-1). Any other text is allowed and treated as "other city". */
  cities: string[]
  /** Optional per-group hint, e.g. hotel limit per night. */
  tier1Hint?: string
  otherHint?: string
  invalid?: boolean
  placeholder?: string
  testId?: string
}

type Opt = { value: string; kind: "tier1" | "custom" }

/** Accessible combobox (WAI-ARIA 1.2 pattern): free text + a themed suggestion list. */
export function CityCombobox({ id, value, onChange, onBlur, cities, tier1Hint, otherHint, invalid, placeholder = "Search city", testId }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const listId = useId()

  const q = value.trim().toLowerCase()
  const options = useMemo<Opt[]>(() => {
    const matches = cities.filter((c) => c.toLowerCase().includes(q)).sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)))
    const out: Opt[] = matches.map((c) => ({ value: c, kind: "tier1" }))
    if (q && !cities.some((c) => c.toLowerCase() === q)) out.push({ value: value.trim(), kind: "custom" })
    return out
  }, [cities, q, value])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false)
        onBlur?.()
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, onBlur])

  const choose = (o: Opt) => {
    onChange(o.value)
    setOpen(false)
    input.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (!open) setOpen(true)
      else setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault()
      choose(options[active])
    } else if (e.key === "Escape") {
      setOpen(false)
    } else if (e.key === "Tab") {
      setOpen(false)
    }
  }

  const selectedKnown = cities.find((c) => c.toLowerCase() === q)
  const activeId = open && options[active] ? `${listId}-${active}` : undefined

  return (
    <div ref={wrap} className="relative">
      <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-4" />
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(e) => {
          onChange(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-control border border-line-strong bg-surface pr-9 pl-9 text-[14px] text-ink shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-4 hover:border-ink-4 focus:border-cobalt focus:ring-3 focus:ring-cobalt/12 aria-invalid:border-danger"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? "Close city list" : "Open city list"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setOpen((o) => !o)
          input.current?.focus()
        }}
        className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink"
      >
        <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Cities"
          className="scroll-thin absolute top-[calc(100%+6px)] right-0 left-0 z-40 max-h-64 origin-top animate-pop overflow-y-auto rounded-[12px] border border-line bg-surface p-1 shadow-lg min-w-[250px]"
        >
          {options.some((o) => o.kind === "tier1") && (
            <li role="presentation" className="flex items-center justify-between px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-[0.05em] text-ink-3 uppercase">
              Tier-1 cities {tier1Hint && <span className="font-normal tracking-normal normal-case">{tier1Hint}</span>}
            </li>
          )}
          {options.map((o, i) => (
            <li
              key={`${o.kind}-${o.value}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
              className={cn(
                "flex items-center gap-2 rounded-[8px] px-2.5 py-2 text-[13.5px] transition-colors",
                i === active ? "bg-surface-3 text-ink" : "text-ink-2",
                o.kind === "custom" && "mt-1 border-t border-line pt-2.5",
              )}
            >
              {o.kind === "custom" ? <Plus className="size-3.5 text-ink-3" /> : <MapPin className="size-3.5 text-ink-4" />}
              <span className="flex-1 truncate">{o.kind === "custom" ? <>Use “{o.value}”</> : o.value}</span>
              {o.kind === "custom" ? otherHint && <span className="text-[11.5px] text-ink-3">{otherHint}</span> : selectedKnown === o.value && <Check className="size-4 text-ink" />}
            </li>
          ))}
          {options.length === 0 && <li className="px-2.5 py-2 text-[13px] text-ink-3">Type a city name</li>}
        </ul>
      )}
    </div>
  )
}
