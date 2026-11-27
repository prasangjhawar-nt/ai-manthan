package com.expenseflow.dto;

import com.expenseflow.model.ApprovalDecision;
import com.expenseflow.model.ApprovalLevel;
import com.expenseflow.model.ApprovalStep;

import java.time.Instant;

public record ApprovalStepDto(
        Long id,
        ApprovalLevel level,
        Long approverId,
        String approverName,
        Long actedById,
        String actedByName,
        ApprovalDecision decision,
        String comment,
        Instant decidedAt
) {
    public static ApprovalStepDto from(ApprovalStep s) {
        return new ApprovalStepDto(
                s.getId(),
                s.getLevel(),
                s.getApprover().getId(),
                s.getApprover().getName(),
                s.getActedBy().getId(),
                s.getActedBy().getName(),
                s.getDecision(),
                s.getComment(),
                s.getDecidedAt()
        );
    }
}
