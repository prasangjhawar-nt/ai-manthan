import { api } from "./client"
import type {
  BulkApproveResponse,
  BulkUserResponse,
  CreateUserRequest,
  CreateUserResponse,
  AuditEvent,
  Claim,
  ClaimLineInput,
  ClaimStatus,
  ClaimSummary,
  Comment,
  DashboardSummary,
  Delegation,
  LoginResponse,
  Page,
  PayoutBatch,
  PayoutBatchStatus,
  PolicyConfig,
  QueueFilters,
  ReceiptUpload,
  User,
} from "./types"

/** One function per operationId in hackathon-swagger.yaml. */
export const Api = {
  login: (email: string, password: string) =>
    api<LoginResponse>("/api/auth/login", { method: "POST", body: { email, password } }),
  me: () => api<User>("/api/me"),

  listMyClaims: (q: { status?: ClaimStatus; page?: number; size?: number } = {}) =>
    api<Page<ClaimSummary>>("/api/claims", { query: { size: 100, ...q } }),
  getClaim: (id: number) => api<Claim>(`/api/claims/${id}`),
  createClaim: (body: { title: string; lines: ClaimLineInput[] }, idempotencyKey: string) =>
    api<Claim>("/api/claims", { method: "POST", body, idempotencyKey }),
  updateClaim: (id: number, body: { version: number; title: string; lines: ClaimLineInput[] }) =>
    api<Claim>(`/api/claims/${id}`, { method: "PUT", body }),
  submitClaim: (id: number, idempotencyKey: string) =>
    api<Claim>(`/api/claims/${id}/submit`, { method: "POST", idempotencyKey }),

  uploadReceipt: (file: File) => {
    const fd = new FormData()
    fd.append("file", file)
    return api<ReceiptUpload>("/api/receipts", { method: "POST", body: fd })
  },
  getReceiptContent: (id: number) => api<Response>(`/api/receipts/${id}/content`, { raw: true }),

  getApprovalQueue: (f: QueueFilters = {}) =>
    api<Page<ClaimSummary>>("/api/approvals/queue", { query: { size: 100, ...f } }),
  approveClaim: (id: number, comment?: string) =>
    api<Claim>(`/api/claims/${id}/approve`, { method: "POST", body: { comment: comment || null } }),
  sendBackClaim: (id: number, comment: string) =>
    api<Claim>(`/api/claims/${id}/send-back`, { method: "POST", body: { comment } }),
  rejectClaim: (id: number, reason: string) =>
    api<Claim>(`/api/claims/${id}/reject`, { method: "POST", body: { reason } }),
  bulkApprove: (claimIds: number[], comment: string | null, idempotencyKey: string) =>
    api<BulkApproveResponse>("/api/approvals/bulk-approve", { method: "POST", body: { claimIds, comment }, idempotencyKey }),
  resolveSampleAudit: (id: number, result: "CLEARED" | "FAILED", reason?: string) =>
    api<Claim>(`/api/claims/${id}/sample-audit`, { method: "POST", body: { result, reason: reason || null } }),

  listComments: (id: number) => api<Comment[]>(`/api/claims/${id}/comments`),
  addComment: (id: number, body: string) => api<Comment>(`/api/claims/${id}/comments`, { method: "POST", body: { body } }),
  getAuditTrail: (id: number) => api<AuditEvent[]>(`/api/claims/${id}/audit`),

  listDelegations: () => api<Delegation[]>("/api/delegations"),
  createDelegation: (body: { delegateId: number; fromDate: string; toDate: string }) =>
    api<Delegation>("/api/delegations", { method: "POST", body }),

  listPayoutEligible: () => api<Page<ClaimSummary>>("/api/payout/eligible", { query: { size: 100 } }),
  listPayoutBatches: (status?: PayoutBatchStatus) =>
    api<Page<PayoutBatch>>("/api/payout-batches", { query: { status, size: 50 } }),
  createPayoutBatch: (claimIds: number[], idempotencyKey: string) =>
    api<PayoutBatch>("/api/payout-batches", { method: "POST", body: { claimIds }, idempotencyKey }),
  getPayoutBatch: (id: number) => api<PayoutBatch>(`/api/payout-batches/${id}`),
  retryPayoutBatch: (id: number) => api<PayoutBatch>(`/api/payout-batches/${id}/retry`, { method: "POST" }),
  downloadPayoutFile: (id: number) => api<Response>(`/api/payout-batches/${id}/file`, { raw: true }),

  getDashboard: (from?: string, to?: string) => api<DashboardSummary>("/api/dashboard/summary", { query: { from, to } }),
  getPolicy: () => api<PolicyConfig>("/api/policy-rules"),

  createUser: (body: CreateUserRequest) => api<CreateUserResponse>("/api/admin/users", { method: "POST", body }),
  bulkCreateUsers: (file: File) => {
    const fd = new FormData()
    fd.append("file", file)
    return api<BulkUserResponse>("/api/admin/users/bulk", { method: "POST", body: fd })
  },
}
