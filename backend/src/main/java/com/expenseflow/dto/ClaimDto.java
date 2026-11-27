package com.expenseflow.dto;

import com.expenseflow.model.ApprovalLevel;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.SampleAuditStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record ClaimDto(
        Long id,
        String claimNumber,
        Long employeeId,
        String employeeName,
        String departmentName,
        String title,
        ClaimStatus status,
        BigDecimal totalAmount,
        ApprovalLevel currentLevel,
        SampleAuditStatus sampleAudit,
        Instant submittedAt,
        Instant finalDecisionAt,
        Instant paidAt,
        Long payoutBatchId,
        Long version,
        Instant createdAt,
        Instant updatedAt,
        List<ClaimLineDto> lines,
        List<ApprovalStepDto> approvalSteps
) {
    public static ClaimDto from(Claim c, List<ApprovalStepDto> steps) {
        return new ClaimDto(
                c.getId(),
                c.getClaimNumber(),
                c.getEmployee().getId(),
                c.getEmployee().getName(),
                c.getEmployee().getDepartment().getName(),
                c.getTitle(),
                c.getStatus(),
                c.getTotalAmount(),
                currentLevel(c.getStatus()),
                c.getSampleAudit(),
                c.getSubmittedAt(),
                c.getFinalDecisionAt(),
                c.getPaidAt(),
                c.getPayoutBatch() == null ? null : c.getPayoutBatch().getId(),
                c.getVersion(),
                c.getCreatedAt(),
                c.getUpdatedAt(),
                c.getLines().stream().map(ClaimLineDto::from).toList(),
                steps
        );
    }

    private static ApprovalLevel currentLevel(ClaimStatus s) {
        return switch (s) {
            case PENDING_MANAGER -> ApprovalLevel.MANAGER;
            case PENDING_AUDITOR -> ApprovalLevel.AUDITOR;
            case PENDING_HEAD    -> ApprovalLevel.HEAD;
            default -> null;
        };
    }
}
