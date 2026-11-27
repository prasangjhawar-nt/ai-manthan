package com.expenseflow.dto;

import com.expenseflow.model.ClaimStatus;

import java.util.List;

public record BulkApproveResponse(int processed, int succeeded, int failed, List<Result> results) {

    public record Result(
            Long claimId,
            String claimNumber,
            String outcome,         // APPROVED | PENDING_HEAD | SKIPPED
            ClaimStatus newStatus,
            Integer errorStatus,
            String errorDetail
    ) {}
}
