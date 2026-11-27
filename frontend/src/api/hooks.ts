import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { toast } from "sonner"
import { Api } from "./endpoints"
import { ApiError } from "./client"
import type { ClaimStatus, QueueFilters } from "./types"

export const qk = {
  myClaims: (status?: ClaimStatus) => ["claims", "mine", status ?? "ALL"] as const,
  claim: (id: number) => ["claims", id] as const,
  comments: (id: number) => ["claims", id, "comments"] as const,
  audit: (id: number) => ["claims", id, "audit"] as const,
  queue: (f: QueueFilters) => ["queue", f] as const,
  eligible: ["payout", "eligible"] as const,
  batches: ["payout", "batches"] as const,
  dashboard: (from?: string, to?: string) => ["dashboard", from, to] as const,
  policy: ["policy"] as const,
  delegations: ["delegations"] as const,
}

export const useMyClaims = (status?: ClaimStatus) =>
  useQuery({ queryKey: qk.myClaims(status), queryFn: () => Api.listMyClaims({ status }), placeholderData: keepPreviousData })
export const useClaim = (id: number) => useQuery({ queryKey: qk.claim(id), queryFn: () => Api.getClaim(id), enabled: Number.isFinite(id) })
export const useComments = (id: number) => useQuery({ queryKey: qk.comments(id), queryFn: () => Api.listComments(id) })
export const useAuditTrail = (id: number) => useQuery({ queryKey: qk.audit(id), queryFn: () => Api.getAuditTrail(id) })
export const useQueue = (f: QueueFilters) =>
  useQuery({ queryKey: qk.queue(f), queryFn: () => Api.getApprovalQueue(f), placeholderData: keepPreviousData })
export const usePolicy = () => useQuery({ queryKey: qk.policy, queryFn: Api.getPolicy, staleTime: 10 * 60_000 })
export const useDashboard = (from?: string, to?: string) =>
  useQuery({ queryKey: qk.dashboard(from, to), queryFn: () => Api.getDashboard(from, to) })
export const useEligible = () => useQuery({ queryKey: qk.eligible, queryFn: Api.listPayoutEligible })
export const useBatches = () =>
  useQuery({
    queryKey: qk.batches,
    queryFn: () => Api.listPayoutBatches(),
    // Poll while any batch is waiting for the bank (R12 demo).
    refetchInterval: (q) => (q.state.data?.content.some((b) => b.status === "PENDING_SEND") ? 4000 : false),
  })
export const useDelegations = () => useQuery({ queryKey: qk.delegations, queryFn: Api.listDelegations })

/** Invalidate everything claim-shaped after a state change. */
export function useInvalidateClaims() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["claims"] }),
      qc.invalidateQueries({ queryKey: ["queue"] }),
      qc.invalidateQueries({ queryKey: ["payout"] }),
      qc.invalidateQueries({ queryKey: ["dashboard"] }),
    ])
}

export function useDecision(id: number) {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: (v: { action: "approve" | "send-back" | "reject"; comment: string }) =>
      v.action === "approve"
        ? Api.approveClaim(id, v.comment)
        : v.action === "send-back"
          ? Api.sendBackClaim(id, v.comment)
          : Api.rejectClaim(id, v.comment),
    onSuccess: invalidate,
  })
}

export function toastError(e: unknown, fallback = "Something went wrong") {
  if (e instanceof ApiError) {
    if (e.status === 429) return toast.warning("Slow down", { description: "Too many requests — try again in a few seconds." })
    toast.error(e.problem.title || fallback, {
      description: [e.problem.detail, e.problem.correlationId && `Ref ${e.problem.correlationId}`].filter(Boolean).join(" · "),
    })
  } else toast.error(fallback)
}
