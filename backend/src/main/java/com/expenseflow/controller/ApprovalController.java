package com.expenseflow.controller;

import com.expenseflow.dto.ApproveRequest;
import com.expenseflow.dto.BulkApproveRequest;
import com.expenseflow.dto.BulkApproveResponse;
import com.expenseflow.dto.ClaimDto;
import com.expenseflow.dto.ClaimSummaryDto;
import com.expenseflow.dto.PageDto;
import com.expenseflow.dto.RejectRequest;
import com.expenseflow.dto.SampleAuditRequest;
import com.expenseflow.dto.SendBackRequest;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Category;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.service.ApprovalService;
import com.expenseflow.service.QueueService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;

@RestController
@RequestMapping("/api")
public class ApprovalController {

    private final ApprovalService approvals;
    private final QueueService queue;

    public ApprovalController(ApprovalService approvals, QueueService queue) {
        this.approvals = approvals;
        this.queue = queue;
    }

    @GetMapping("/approvals/queue")
    public PageDto<ClaimSummaryDto> queue(
            @RequestParam(required = false) Long departmentId,
            @RequestParam(required = false) Category category,
            @RequestParam(required = false) String flag,
            @RequestParam(required = false) ClaimStatus status,
            @RequestParam(required = false) BigDecimal minAmount,
            @RequestParam(required = false) BigDecimal maxAmount,
            @RequestParam(required = false) LocalDate submittedFrom,
            @RequestParam(required = false) LocalDate submittedTo,
            @RequestParam(defaultValue = "false") boolean sampleAuditOnly,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        if (size < 1 || size > 100) throw ApiException.badRequest("size must be 1..100");
        return queue.queue(departmentId, category, flag, status, minAmount, maxAmount,
                submittedFrom, submittedTo, sampleAuditOnly, page, size);
    }

    @PostMapping("/claims/{id}/approve")
    public ClaimDto approve(@PathVariable Long id, @Valid @RequestBody(required = false) ApproveRequest req) {
        return approvals.approve(id, req == null ? null : req.comment());
    }

    @PostMapping("/claims/{id}/send-back")
    public ClaimDto sendBack(@PathVariable Long id, @Valid @RequestBody SendBackRequest req) {
        return approvals.sendBack(id, req.comment());
    }

    @PostMapping("/claims/{id}/reject")
    public ClaimDto reject(@PathVariable Long id, @Valid @RequestBody RejectRequest req) {
        return approvals.reject(id, req.reason());
    }

    @PostMapping("/approvals/bulk-approve")
    public BulkApproveResponse bulkApprove(
            @RequestHeader("Idempotency-Key") String idemKey,
            @Valid @RequestBody BulkApproveRequest req) {
        return approvals.bulkApprove(req.claimIds(), req.comment(), idemKey);
    }

    @PostMapping("/claims/{id}/sample-audit")
    public ClaimDto sampleAudit(@PathVariable Long id, @Valid @RequestBody SampleAuditRequest req) {
        return approvals.resolveSampleAudit(id, req);
    }
}
