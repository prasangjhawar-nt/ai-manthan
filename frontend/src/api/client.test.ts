import { beforeEach, describe, expect, it, vi } from "vitest"

// Replace the transport (src/api/mock.ts) so we can assert exactly what the client sends/handles.
const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>()
vi.mock("./mock", () => ({ mockFetch: (url: string, init: RequestInit) => transport(url, init), mockConfig: { latencyMs: 0 }, resetMockDb: () => {} }))

const { api, ApiError, session, setUnauthorizedHandler, newIdempotencyKey } = await import("./client")

/** Expects a rejection and returns it typed (fails the test if the call succeeds). */
const fail = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected the request to fail")
    },
    (x) => x as InstanceType<typeof ApiError>,
  )

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })

beforeEach(() => {
  transport.mockReset()
  localStorage.clear()
  setUnauthorizedHandler(() => {})
})

describe("request building", () => {
  it("adds Bearer token, Idempotency-Key and JSON content type", async () => {
    session.save("tok-123", { id: 1 })
    transport.mockResolvedValue(json(200, { ok: true }))
    await api("/api/claims", { method: "POST", body: { a: 1 }, idempotencyKey: "key-1" })
    const [url, init] = transport.mock.calls[0]
    const h = init.headers as Record<string, string>
    expect(url).toBe("/api/claims")
    expect(init.method).toBe("POST")
    expect(h.Authorization).toBe("Bearer tok-123")
    expect(h["Idempotency-Key"]).toBe("key-1")
    expect(h["Content-Type"]).toBe("application/json")
    expect(init.body).toBe('{"a":1}')
  })

  it("leaves Content-Type to the browser for multipart uploads", async () => {
    transport.mockResolvedValue(json(201, {}))
    const fd = new FormData()
    fd.append("file", new File(["x"], "r.png", { type: "image/png" }))
    await api("/api/receipts", { method: "POST", body: fd })
    const h = transport.mock.calls[0][1].headers as Record<string, string>
    expect(h["Content-Type"]).toBeUndefined()
    expect(transport.mock.calls[0][1].body).toBe(fd)
  })

  it("drops empty query params but keeps 0", async () => {
    transport.mockResolvedValue(json(200, {}))
    await api("/api/approvals/queue", { query: { flag: undefined, category: "", sampleAuditOnly: false, minAmount: 0, page: 2, departmentId: null } })
    expect(transport.mock.calls[0][0]).toBe("/api/approvals/queue?minAmount=0&page=2")
  })

  it("sends no Authorization header when signed out", async () => {
    transport.mockResolvedValue(json(200, {}))
    await api("/api/policy-rules")
    expect((transport.mock.calls[0][1].headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it("idempotency keys are unique UUIDs", () => {
    const a = newIdempotencyKey()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(newIdempotencyKey()).not.toBe(a)
  })
})

describe("response handling", () => {
  it("parses JSON, text (CSV) and 204", async () => {
    transport.mockResolvedValueOnce(json(200, { n: 1 }))
    expect(await api("/x")).toEqual({ n: 1 })
    transport.mockResolvedValueOnce(new Response("a,b\n1,2\n", { status: 200, headers: { "Content-Type": "text/csv" } }))
    expect(await api("/file")).toBe("a,b\n1,2\n")
    transport.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await api("/none")).toBeUndefined()
  })

  it("raw mode returns the Response (for blobs)", async () => {
    const res = new Response(new Blob(["img"], { type: "image/png" }), { status: 200, headers: { "Content-Type": "image/png" } })
    transport.mockResolvedValue(res)
    const out = await api<Response>("/api/receipts/1/content", { raw: true })
    expect(out).toBe(res)
  })

  it("wraps RFC 9457 problems in ApiError, including field errors", async () => {
    transport.mockResolvedValue(json(400, { title: "Validation failed", status: 400, detail: "1 field is invalid", correlationId: "abc", errors: [{ field: "title", message: "must not be blank" }] }))
    const e = await fail(api("/api/claims"))
    expect(e).toBeInstanceOf(ApiError)
    expect(e.status).toBe(400)
    expect(e.message).toBe("1 field is invalid")
    expect(e.problem.errors?.[0].field).toBe("title")
  })

  it("falls back to statusText and X-Request-ID when the error body isn't JSON", async () => {
    transport.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway", headers: { "X-Request-ID": "rid-9" } }))
    const e = await fail(api("/api/claims"))
    expect(e.status).toBe(502)
    expect(e.problem.title).toBe("Bad Gateway")
    expect(e.problem.correlationId).toBe("rid-9")
  })

  it("network failure → status 0 with a friendly message", async () => {
    transport.mockRejectedValue(new TypeError("Failed to fetch"))
    const e = await fail(api("/api/claims"))
    expect(e.status).toBe(0)
    expect(e.problem.title).toBe("Network error")
  })

  it("401 on a data call triggers sign-out, but not on the login call itself", async () => {
    const onUnauth = vi.fn()
    setUnauthorizedHandler(onUnauth)
    transport.mockResolvedValue(json(401, { title: "Unauthorized", status: 401 }))
    await api("/api/auth/login", { method: "POST", body: {} }).catch(() => {})
    expect(onUnauth).not.toHaveBeenCalled()
    await api("/api/claims").catch(() => {})
    expect(onUnauth).toHaveBeenCalledOnce()
  })

  it("403/404/409 do not sign the user out", async () => {
    const onUnauth = vi.fn()
    setUnauthorizedHandler(onUnauth)
    for (const s of [403, 404, 409]) {
      transport.mockResolvedValueOnce(json(s, { title: "x", status: s }))
      await api("/api/claims/1").catch(() => {})
    }
    expect(onUnauth).not.toHaveBeenCalled()
  })
})

describe("session storage", () => {
  it("stores token, user and expiry; clears all three", () => {
    session.save("t", { id: 7 }, 3600)
    expect(session.token).toBe("t")
    expect(session.user<{ id: number }>()?.id).toBe(7)
    expect(session.msLeft).toBeGreaterThan(3_500_000)
    session.clear()
    expect(session.token).toBeNull()
    expect(session.user()).toBeNull()
  })

  it("treats a corrupt stored user as signed out", () => {
    localStorage.setItem("ef.user", "{not json")
    expect(session.user()).toBeNull()
  })
})
