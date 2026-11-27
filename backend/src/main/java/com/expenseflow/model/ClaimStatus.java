package com.expenseflow.model;

public enum ClaimStatus {
    DRAFT,
    SUBMITTED,
    PENDING_MANAGER,
    PENDING_AUDITOR,
    PENDING_HEAD,
    NEEDS_CLARIFICATION,
    APPROVED,
    REJECTED,
    IN_PAYOUT,
    PAID
}
