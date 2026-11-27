import type { ProblemDetail } from "./types"

const TOKEN_KEY = "ef.token"
const USER_KEY = "ef.user"
const EXP_KEY = "ef.exp"

export const session = {
  /** Returns the token only while it is unexpired (JWT is 1 h; we don't refresh). */
  get token() {
    try {
      const t = localStorage.getItem(TOKEN_KEY)
      const exp = Number(localStorage.getItem(EXP_KEY) ?? 0)
      if (t && exp && Date.now() >= exp) {
        session.clear()
        return null
      }
      return t
    } catch {
      return null
    }
  },
  /** ms until the token expires, or null. */
  get msLeft() {
    const exp = Number(localStorage.getItem(EXP_KEY) ?? 0)
    return exp ? exp - Date.now() : null
  },
  save(token: string, user: unknown, expiresInSeconds = 3600) {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    localStorage.setItem(EXP_KEY, String(Date.now() + expiresInSeconds * 1000 - 5_000))
  },
  user<T>(): T | null {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(EXP_KEY)
  },
}

/** RFC 9457 problem wrapped as an Error so TanStack Query can carry it. */
export class ApiError extends Error {
  status: number
  problem: ProblemDetail
  constructor(problem: ProblemDetail) {
    super(problem.detail || problem.title)
    this.status = problem.status
    this.problem = problem
  }
}

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler = () => {}
export function setUnauthorizedHandler(fn: UnauthorizedHandler) {
  onUnauthorized = fn
}

export const newIdempotencyKey = () => crypto.randomUUID()

type Query = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE"
  body?: unknown
  query?: Query
  idempotencyKey?: string
  raw?: boolean
}

// Mock mode: `npm run dev:mock` serves the whole API from src/api/mock.ts.
const USE_MOCK = import.meta.env.VITE_MOCK === "1"

function buildUrl(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "" && v !== false) params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

async function transport(url: string, init: RequestInit): Promise<Response> {
  if (USE_MOCK) {
    const { mockFetch } = await import("./mock")
    return mockFetch(url, init)
  }
  return fetch(url, init)
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" }
  const token = session.token
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey

  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify(opts.body)
  }

  let res: Response
  try {
    res = await transport(buildUrl(path, opts.query), { method: opts.method ?? "GET", headers, body })
  } catch {
    throw new ApiError({ title: "Network error", status: 0, detail: "Can't reach the server. Check your connection and try again." })
  }

  if (!res.ok) {
    let problem: ProblemDetail
    try {
      problem = await res.json()
    } catch {
      problem = { title: res.statusText || "Request failed", status: res.status }
    }
    problem.status ??= res.status
    problem.correlationId ??= res.headers.get("X-Request-ID") ?? undefined
    if (res.status === 401 && !path.endsWith("/auth/login")) onUnauthorized()
    throw new ApiError(problem)
  }

  if (opts.raw) return res as unknown as T
  if (res.status === 204) return undefined as T
  const type = res.headers.get("Content-Type") ?? ""
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>
}
