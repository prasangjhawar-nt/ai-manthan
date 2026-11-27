// Types mirror hackathon-swagger.yaml (contract-v1). Keep in sync — additive only.

export type Role = "EMPLOYEE" | "MANAGER" | "AUDITOR" | "HEAD"
export type ClaimStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "PENDING_MANAGER"
  | "PENDING_AUDITOR"
  | "PENDING_HEAD"
  | "NEEDS_CLARIFICATION"
  | "APPROVED"
  | "REJECTED"
  | "IN_PAYOUT"
  | "PAID"
export type Category = "MEALS" | "HOTEL" | "LOCAL_CAB" | "FLIGHT" | "TRAIN" | "OTHER"
export type Flag = "OVER_LIMIT" | "MISSING_RECEIPT" | "DUPLICATE" | "WEEKEND" | "NO_POLICY"
export type LineOutcome = "AUTO_APPROVE" | "ROUTE" | "AUTO_REJECT"
export type ApprovalLevel = "MANAGER" | "AUDITOR" | "HEAD"
export type Decision = "APPROVED" | "SENT_BACK" | "REJECTED"
export type SampleAuditStatus = "NONE" | "OPEN" | "CLEARED" | "FAILED"
export type PayoutBatchStatus = "PENDING_SEND" | "SENT"

export const CATEGORIES: Category[] = ["HOTEL", "FLIGHT", "MEALS", "LOCAL_CAB", "TRAIN", "OTHER"]
export const FLAGS: Flag[] = ["OVER_LIMIT", "MISSING_RECEIPT", "DUPLICATE", "WEEKEND", "NO_POLICY"]

export interface ProblemDetail {
  type?: string
  title: string
  status: number
  detail?: string
  instance?: string
  correlationId?: string
  errors?: { field: string; message: string }[]
}

export interface User {
  id: number
  employeeCode: string
  name: string
  email: string
  role: Role
  departmentId: number
  departmentName: string
  managerId?: number | null
}

export interface LoginResponse {
  token: string
  tokenType: "Bearer"
  expiresInSeconds: number
  user: User
}

export interface ClaimLineInput {
  category: Category
  expenseDate: string
  amount: number
  vendor: string
  city?: string | null
  nights?: number | null
  description?: string | null
  receiptId?: number | null
}

export interface ClaimLine extends ClaimLineInput {
  id: number
  lineNo: number
  outcome: LineOutcome | null
  flags: Flag[]
  reason: string | null
}

export interface ApprovalStep {
  id: number
  level: ApprovalLevel
  approverId: number
  approverName?: string
  actedById: number
  actedByName?: string
  decision: Decision
  comment?: string | null
  decidedAt: string
}

export interface Claim {
  id: number
  claimNumber: string
  employeeId: number
  employeeName: string
  departmentName?: string
  title: string
  status: ClaimStatus
  totalAmount: number
  currentLevel: ApprovalLevel | null
  sampleAudit: SampleAuditStatus
  submittedAt: string | null
  finalDecisionAt: string | null
  paidAt: string | null
  payoutBatchId: number | null
  version: number
  createdAt: string
  updatedAt: string
  lines: ClaimLine[]
  approvalSteps: ApprovalStep[]
}

export interface ClaimSummary {
  id: number
  claimNumber: string
  title: string
  status: ClaimStatus
  totalAmount: number
  employeeId: number
  employeeName: string
  departmentName?: string
  submittedAt: string | null
  flags: Flag[]
  sampleAudit: SampleAuditStatus
  currentLevel: ApprovalLevel | null
  waitingHours: number | null
}

export interface Page<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export interface ReceiptUpload {
  id: number
  fileName: string
  contentType: "image/jpeg" | "image/png" | "application/pdf"
  sizeBytes: number
  sha256: string
  duplicateOfReceiptId: number | null
  uploadedAt: string
}

export interface BulkApproveResult {
  claimId: number
  claimNumber: string | null
  outcome: "APPROVED" | "PENDING_HEAD" | "SKIPPED"
  newStatus: ClaimStatus | null
  errorStatus: number | null
  errorDetail: string | null
}

export interface BulkApproveResponse {
  processed: number
  succeeded: number
  failed: number
  results: BulkApproveResult[]
}

export interface Comment {
  id: number
  claimId: number
  authorId: number
  authorName: string
  authorRole: Role
  body: string
  createdAt: string
}

export type AuditAction =
  | "CLAIM_CREATED"
  | "CLAIM_UPDATED"
  | "CLAIM_SUBMITTED"
  | "POLICY_EVALUATED"
  | "CLAIM_APPROVED"
  | "CLAIM_SENT_BACK"
  | "CLAIM_REJECTED"
  | "SAMPLE_AUDIT_CLEARED"
  | "SAMPLE_AUDIT_FAILED"
  | "COMMENT_ADDED"
  | "RECEIPT_UPLOADED"
  | "DELEGATION_CREATED"
  | "PAYOUT_BATCH_CREATED"
  | "PAYOUT_SEND_FAILED"
  | "PAYOUT_SENT"
  | "CLAIM_PAID"
  | "LOGIN"
  | "SEEDED"
  | "USER_CREATED"

export interface AuditEvent {
  id: number
  actorId: number
  actorName?: string
  onBehalfOfId: number | null
  onBehalfOfName: string | null
  action: AuditAction
  entityType: "CLAIM" | "RECEIPT" | "DELEGATION" | "PAYOUT_BATCH" | "USER"
  entityId: number
  claimId: number | null
  fromStatus: ClaimStatus | null
  toStatus: ClaimStatus | null
  details: Record<string, unknown> | null
  correlationId: string | null
  createdAt: string
}

export interface Delegation {
  id: number
  approverId: number
  approverName?: string
  delegateId: number
  delegateName?: string
  fromDate: string
  toDate: string
  active: boolean
  createdAt: string
}

export interface PayoutBatch {
  id: number
  batchRef: string
  status: PayoutBatchStatus
  claimCount: number
  totalAmount: number
  fileName: string
  attempts: number
  lastError: string | null
  bankReference: string | null
  createdById: number
  createdByName?: string
  createdAt: string
  sentAt: string | null
  claims: ClaimSummary[] | null
}

export interface DashboardSummary {
  from: string
  to: string
  kpis: {
    pendingByLevel: Record<ApprovalLevel, number>
    oldestPendingHours: number | null
    policyViolations: number
    avgApprovalHours: number | null
    totalPaid: number
  }
  spendByCategory: { category: Category; amount: number }[]
  spendByDepartment: { departmentId: number; departmentName: string; amount: number }[]
  spendByMonth: { month: string; amount: number }[]
  violationsByFlag: { flag: Flag; count: number }[]
  exceptions: ClaimSummary[]
}

export interface PolicyRule {
  id: number
  code: string
  category: Category
  limitAmount: number
  unit: "PER_DAY" | "PER_NIGHT" | "PER_TRIP"
  cityTier: number | null
  active: boolean
  description?: string
}

export interface PolicyConfig {
  rules: PolicyRule[]
  settings: { key: string; value: string; description?: string }[]
  tier1Cities: string[]
}

export interface QueueFilters {
  departmentId?: number
  category?: Category
  flag?: Flag
  status?: ClaimStatus
  minAmount?: number
  maxAmount?: number
  submittedFrom?: string
  submittedTo?: string
  sampleAuditOnly?: boolean
  page?: number
  size?: number
}

// ---------- admin (user provisioning, ST-13 — additive to contract-v1)
export interface CreateUserRequest {
  employeeCode: string
  name: string
  email: string
  role: Role
  departmentId: number
  /** Required when role is EMPLOYEE; may be null for MANAGER/AUDITOR/HEAD. */
  managerId: number | null
  accountNumber: string
  ifsc: string
}

export interface CreateUserResponse {
  user: User
  /** Server-generated, returned ONCE. */
  temporaryPassword: string
}

export interface BulkUserResult {
  /** 1-based CSV row (header is row 1). */
  row: number
  employeeCode: string | null
  email: string | null
  outcome: "CREATED" | "SKIPPED"
  userId: number | null
  temporaryPassword: string | null
  errorStatus: number | null
  errorDetail: string | null
}

export interface BulkUserResponse {
  processed: number
  succeeded: number
  failed: number
  results: BulkUserResult[]
}
