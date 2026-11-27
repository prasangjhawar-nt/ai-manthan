import "@testing-library/jest-dom/vitest"
import { afterEach, beforeEach } from "vitest"
import { cleanup, configure } from "@testing-library/react"
import { mockConfig, resetMockDb } from "@/api/mock"

// jsdom gaps used by the UI
if (!window.matchMedia) {
  window.matchMedia = (q: string) =>
    ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList
}
if (!("ResizeObserver" in window)) {
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
Element.prototype.scrollIntoView ??= function () {}
Element.prototype.scrollTo ??= function () {}

mockConfig.latencyMs = 0

// Pages are lazy-loaded chunks; on a busy machine the first import can exceed the 1 s default.
configure({ asyncUtilTimeout: 5000 })

beforeEach(() => {
  localStorage.clear()
  resetMockDb()
})
afterEach(() => cleanup())
