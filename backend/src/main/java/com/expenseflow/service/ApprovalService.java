package com.expenseflow.service;

import com.expenseflow.dto.BulkApproveResponse;
import com.expenseflow.dto.ClaimDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.ApprovalDecision;
import com.expenseflow.model.ApprovalLevel;
import com.expenseflow.model.ApprovalStep;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Employee;
import com.expenseflow.model.IdempotencyKey;
import com.expenseflow.model.Role;
import com.expenseflow.model.SampleAuditStatus;
import com.expenseflow.repository.ApprovalStepRepository;
import com.expenseflow.repository.ClaimRepository;
import com.expenseflow.repository.DelegationRepository;
import com.expenseflow.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class ApprovalService {

    private final ClaimRepository claims;
    private final ApprovalStepRepository steps;
    private final DelegationRepository delegations;
    private final CurrentUser current;
    private final AuditService audit;
    private final ClaimService claimService;
    private final IdempotencyService idem;
    private final PolicyConfigCache policyCache;
    private org.springframework.transaction.support.TransactionTemplate perClaimTx;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setTransactionManager(org.springframework.transaction.PlatformTransactionManager tm) {
        this.perClaimTx = new org.springframework.transaction.support.TransactionTemplate(tm);
        this.perClaimTx.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public ApprovalService(ClaimRepository claims, ApprovalStepRepository steps,
                           DelegationRepository delegations, CurrentUser current,
                           AuditService audit, ClaimService claimService,
                           IdempotencyService idem, PolicyConfigCache policyCache) {
        this.claims = claims;
        this.steps = steps;
        this.delegations = delegations;
        this.current = current;
        this.audit = audit;
        this.claimService = claimService;
        this.idem = idem;
        this.policyCache = policyCache;
    }

    // ---------- approve / send-back / reject ----------

    @Transactional
    public ClaimDto approve(Long claimId, String comment) {
        Employee caller = current.employee();
        Claim c = claimService.loadForAction(claimId, caller);
        ApprovalContext ctx = resolveActor(c, caller);

        BigDecimal auditorAbove = policyCache.get().money("approval.auditor.above");
        BigDecimal headAbove = policyCache.get().money("approval.head.above");

        ClaimStatus prior = c.getStatus();
        ClaimStatus next = switch (prior) {
            case PENDING_MANAGER -> c.getTotalAmount().compareTo(auditorAbove) > 0
                    ? ClaimStatus.PENDING_AUDITOR : ClaimStatus.APPROVED;
            case PENDING_AUDITOR -> needsHead(c, headAbove) ? ClaimStatus.PENDING_HEAD : ClaimStatus.APPROVED;
            case PENDING_HEAD -> ClaimStatus.APPROVED;
            default -> throw ApiException.conflict("Action approve is not allowed in status " + prior);
        };
        StatusFlow.assertTransition(prior, next);

        ApprovalStep step = new ApprovalStep();
        step.setClaim(c);
        step.setLevel(ctx.level);
        step.setApprover(ctx.approverOfRecord);
        step.setActedBy(caller);
        step.setDecision(ApprovalDecision.APPROVED);
        step.setComment(comment);
        steps.save(step);

        c.setStatus(next);
        if (next == ClaimStatus.APPROVED) {
            c.setFinalDecisionAt(Instant.now());
        }
        Claim saved = claims.save(c);

        audit.record(AuditService.Action.CLAIM_APPROVED, AuditService.EntityType.CLAIM,
                saved.getId(), saved.getId(), caller,
                ctx.approverOfRecord.getId().equals(caller.getId()) ? null : ctx.approverOfRecord,
                prior, next,
                Map.of("level", ctx.level.name(),
                        "delegated", !ctx.approverOfRecord.getId().equals(caller.getId())));

        return claimService.toDto(saved);
    }

    @Transactional
    public ClaimDto sendBack(Long claimId, String comment) {
        if (comment == null || comment.isBlank()) {
            throw ApiException.badRequest("comment is required");
        }
        Employee caller = current.employee();
        Claim c = claimService.loadForAction(claimId, caller);
        ApprovalContext ctx = resolveActor(c, caller);
        ClaimStatus prior = c.getStatus();
        StatusFlow.assertTransition(prior, ClaimStatus.NEEDS_CLARIFICATION);

        ApprovalStep step = new ApprovalStep();
        step.setClaim(c);
        step.setLevel(ctx.level);
        step.setApprover(ctx.approverOfRecord);
        step.setActedBy(caller);
        step.setDecision(ApprovalDecision.SENT_BACK);
        step.setComment(comment);
        steps.save(step);

        c.setStatus(ClaimStatus.NEEDS_CLARIFICATION);
        Claim saved = claims.save(c);

        audit.record(AuditService.Action.CLAIM_SENT_BACK, AuditService.EntityType.CLAIM,
                saved.getId(), saved.getId(), caller,
                ctx.approverOfRecord.getId().equals(caller.getId()) ? null : ctx.approverOfRecord,
                prior, ClaimStatus.NEEDS_CLARIFICATION,
                Map.of("level", ctx.level.name(), "comment", comment));

        return claimService.toDto(saved);
    }

    @Transactional
    public ClaimDto reject(Long claimId, String reason) {
        if (reason == null || reason.isBlank()) {
            throw ApiException.badRequest("reason is required");
        }
        Employee caller = current.employee();
        Claim c = claimService.loadForAction(claimId, caller);
        ApprovalContext ctx = resolveActor(c, caller);
        ClaimStatus prior = c.getStatus();
        StatusFlow.assertTransition(prior, ClaimStatus.REJECTED);

        ApprovalStep step = new ApprovalStep();
        step.setClaim(c);
        step.setLevel(ctx.level);
        step.setApprover(ctx.approverOfRecord);
        step.setActedBy(caller);
        step.setDecision(ApprovalDecision.REJECTED);
        step.setComment(reason);
        steps.save(step);

        c.setStatus(ClaimStatus.REJECTED);
        c.setFinalDecisionAt(Instant.now());
        Claim saved = claims.save(c);

        audit.record(AuditService.Action.CLAIM_REJECTED, AuditService.EntityType.CLAIM,
                saved.getId(), saved.getId(), caller,
                ctx.approverOfRecord.getId().equals(caller.getId()) ? null : ctx.approverOfRecord,
                prior, ClaimStatus.REJECTED,
                Map.of("level", ctx.level.name(), "reason", reason));

        return claimService.toDto(saved);
    }

    // ---------- bulk approve (AUDITOR only) ----------

    @Transactional
    public BulkApproveResponse bulkApprove(List<Long> claimIds, String comment, String idemKey) {
        Employee caller = current.employee();
        if (caller.getRole() != Role.AUDITOR) {
            throw ApiException.forbidden("Only AUDITOR can bulk approve");
        }

        // LinkedHashMap, not Map.of: Map.of iteration order differs per JVM, so the same body hashed differently
        // on the other replica / after a restart and a legitimate replay got 409
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("claimIds", claimIds);
        body.put("comment", comment == null ? "" : comment);
        String bodyHash = idem.hashBody(body);
        idem.acquire(idemKey, caller.getId());
        Optional<IdempotencyKey> existing = idem.findExisting(idemKey, caller.getId());
        if (existing.isPresent()) {
            idem.assertSameBody(existing.get(), bodyHash);
            idem.markReplay();
            return idem.decode(existing.get(), BulkApproveResponse.class);
        }

        BigDecimal headAbove = policyCache.get().money("approval.head.above");

        List<BulkApproveResponse.Result> results = new ArrayList<>();
        int succeeded = 0, failed = 0;
        for (Long id : claimIds) {
            // FR-AUD-2: each claim is processed independently – its own transaction, so one conflicting claim
            // (changed concurrently) does not roll back the others
            BulkApproveResponse.Result r;
            try {
                r = perClaimTx.execute(s -> bulkApproveOne(id, caller, comment, headAbove));
            } catch (org.springframework.dao.OptimisticLockingFailureException e) {
                r = new BulkApproveResponse.Result(id, null, "SKIPPED", null, 409, "Claim was changed concurrently");
            }
            results.add(r);
            if (r.errorStatus() == null) succeeded++; else failed++;
        }

        BulkApproveResponse response = new BulkApproveResponse(claimIds.size(), succeeded, failed, results);
        idem.store(idemKey, caller.getId(), "POST /api/approvals/bulk-approve", bodyHash, 200, response);
        return response;
    }

    private BulkApproveResponse.Result bulkApproveOne(Long id, Employee caller, String comment, BigDecimal headAbove) {
        {
            Optional<Claim> opt = claims.findByIdWithEmployee(id);
            if (opt.isEmpty()) {
                return new BulkApproveResponse.Result(id, null, "SKIPPED", null, 404, "Claim not found");
            }
            Claim c = opt.get();
            if (c.getStatus() != ClaimStatus.PENDING_AUDITOR) {
                return new BulkApproveResponse.Result(id, c.getClaimNumber(), "SKIPPED", null, 409,
                        "Claim is " + c.getStatus() + ", not PENDING_AUDITOR");
            }
            if (c.getEmployee().getId().equals(caller.getId())) {
                return new BulkApproveResponse.Result(id, c.getClaimNumber(), "SKIPPED", null, 403,
                        "Cannot approve own claim");
            }
            ClaimStatus next = needsHead(c, headAbove) ? ClaimStatus.PENDING_HEAD : ClaimStatus.APPROVED;

            ApprovalStep step = new ApprovalStep();
            step.setClaim(c);
            step.setLevel(ApprovalLevel.AUDITOR);
            step.setApprover(caller);
            step.setActedBy(caller);
            step.setDecision(ApprovalDecision.APPROVED);
            step.setComment(comment);
            steps.save(step);

            ClaimStatus prior = c.getStatus();
            c.setStatus(next);
            if (next == ClaimStatus.APPROVED) {
                c.setFinalDecisionAt(Instant.now());
            }
            claims.save(c);

            audit.record(AuditService.Action.CLAIM_APPROVED, AuditService.EntityType.CLAIM,
                    c.getId(), c.getId(), caller, null, prior, next,
                    Map.of("level", "AUDITOR", "bulk", true));

            claims.flush();   // version check happens here, inside this claim's own transaction
            return new BulkApproveResponse.Result(id, c.getClaimNumber(),
                    next == ClaimStatus.APPROVED ? "APPROVED" : "PENDING_HEAD",
                    next, null, null);
        }
    }

    // ---------- sample audit ----------

    @Transactional
    public ClaimDto resolveSampleAudit(Long claimId, com.expenseflow.dto.SampleAuditRequest req) {
        Employee caller = current.employee();
        if (caller.getRole() != Role.AUDITOR) {
            throw ApiException.forbidden("Only AUDITOR can resolve a sample audit");
        }
        Claim c = claimService.loadVisible(claimId, caller);
        if (c.getEmployee().getId().equals(caller.getId())) {
            throw ApiException.forbidden("You can't resolve the sample audit of your own claim");   // R15
        }
        if (c.getSampleAudit() != SampleAuditStatus.OPEN) {
            throw ApiException.conflict("Claim has no open sample audit");
        }
        if (req.result() == com.expenseflow.dto.SampleAuditRequest.Result.FAILED
                && (req.reason() == null || req.reason().isBlank())) {
            throw ApiException.badRequest("reason is required when FAILED");
        }

        ClaimStatus prior = c.getStatus();
        if (req.result() == com.expenseflow.dto.SampleAuditRequest.Result.CLEARED) {
            c.setSampleAudit(SampleAuditStatus.CLEARED);
            audit.record(AuditService.Action.SAMPLE_AUDIT_CLEARED, AuditService.EntityType.CLAIM,
                    c.getId(), c.getId(), caller, null, prior, prior, Map.of());
        } else {
            c.setSampleAudit(SampleAuditStatus.FAILED);
            StatusFlow.assertTransition(prior, ClaimStatus.REJECTED);
            c.setStatus(ClaimStatus.REJECTED);
            c.setFinalDecisionAt(Instant.now());
            audit.record(AuditService.Action.SAMPLE_AUDIT_FAILED, AuditService.EntityType.CLAIM,
                    c.getId(), c.getId(), caller, null, prior, ClaimStatus.REJECTED,
                    Map.of("reason", req.reason()));
        }
        Claim saved = claims.save(c);
        return claimService.toDto(saved);
    }

    /**
     * R9: HEAD level only above approval.head.above. A11: the HEAD's own claim stops at AUDITOR,
     * because there is no second head to approve it (it would otherwise be stuck in PENDING_HEAD).
     */
    private static boolean needsHead(Claim c, BigDecimal headAbove) {
        return c.getTotalAmount().compareTo(headAbove) > 0 && c.getEmployee().getRole() != Role.HEAD;
    }

    // ---------- actor + delegation resolution ----------

    private record ApprovalContext(ApprovalLevel level, Employee approverOfRecord) {}

    private ApprovalContext resolveActor(Claim c, Employee caller) {
        if (c.getEmployee().getId().equals(caller.getId())) {
            throw ApiException.forbidden("You can't approve your own claim");
        }
        return switch (c.getStatus()) {
            case PENDING_MANAGER -> resolveManagerActor(c, caller);
            case PENDING_AUDITOR -> {
                if (caller.getRole() != Role.AUDITOR) {
                    throw ApiException.forbidden("Only AUDITOR can act at this level");
                }
                yield new ApprovalContext(ApprovalLevel.AUDITOR, caller);
            }
            case PENDING_HEAD -> {
                if (caller.getRole() != Role.HEAD) {
                    throw ApiException.forbidden("Only HEAD can act at this level");
                }
                yield new ApprovalContext(ApprovalLevel.HEAD, caller);
            }
            default -> throw ApiException.conflict("Claim is not awaiting a decision");
        };
    }

    private ApprovalContext resolveManagerActor(Claim c, Employee caller) {
        Employee manager = c.getEmployee().getManager();
        if (manager == null) {
            throw ApiException.conflict("Claim has no manager and should not be PENDING_MANAGER");
        }
        if (manager.getId().equals(caller.getId())) {
            return new ApprovalContext(ApprovalLevel.MANAGER, manager);
        }
        boolean isDelegate = delegations.isActiveDelegate(manager.getId(), caller.getId(), LocalDate.now());
        if (!isDelegate) {
            throw ApiException.forbidden("Only the manager or an active delegate can act");
        }
        return new ApprovalContext(ApprovalLevel.MANAGER, manager);
    }
}
