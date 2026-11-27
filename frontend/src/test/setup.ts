import "@testing-library/jest-dom/vitest"
import { afterEach, beforeEach } from "vitest"
import { cleanup } from "@testing-library/react"
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

mockConfig.latencyMs = 0

beforeEach(() => {
  localStorage.clear()
  resetMockDb()
})
afterEach(() => cleanup())
