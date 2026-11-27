package com.expenseflow.dto;

import com.expenseflow.model.ApprovalLevel;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimLine;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.SampleAuditStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public record ClaimSummaryDto(
        Long id,
        String claimNumber,
        String title,
        ClaimStatus status,
        BigDecimal totalAmount,
        Long employeeId,
        String employeeName,
        String departmentName,
        Instant submittedAt,
        List<String> flags,
        SampleAuditStatus sampleAudit,
        ApprovalLevel currentLevel,
        Double waitingHours
) {
    public static ClaimSummaryDto from(Claim c, Double waitingHours) {
        Set<String> flags = new LinkedHashSet<>();
        for (ClaimLine l : c.getLines()) flags.addAll(l.getFlags());
        return new ClaimSummaryDto(
                c.getId(),
                c.getClaimNumber(),
                c.getTitle(),
                c.getStatus(),
                c.getTotalAmount(),
                c.getEmployee().getId(),
                c.getEmployee().getName(),
                c.getEmployee().getDepartment().getName(),
                c.getSubmittedAt(),
                List.copyOf(flags),
                c.getSampleAudit(),
                currentLevel(c.getStatus()),
                waitingHours
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
