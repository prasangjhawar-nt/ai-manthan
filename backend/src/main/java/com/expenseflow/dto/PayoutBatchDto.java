package com.expenseflow.dto;

import com.expenseflow.model.Claim;
import com.expenseflow.model.PayoutBatch;
import com.expenseflow.model.PayoutBatchStatus;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record PayoutBatchDto(
        Long id,
        String batchRef,
        PayoutBatchStatus status,
        int claimCount,
        BigDecimal totalAmount,
        String fileName,
        int attempts,
        String lastError,
        String bankReference,
        Long createdById,
        String createdByName,
        Instant createdAt,
        Instant sentAt,
        List<ClaimSummaryDto> claims
) {
    public static PayoutBatchDto from(PayoutBatch b, List<Claim> claims) {
        List<ClaimSummaryDto> summaries = claims == null ? null
                : claims.stream().map(c -> ClaimSummaryDto.from(c, null)).toList();
        return new PayoutBatchDto(
                b.getId(),
                b.getBatchRef(),
                b.getStatus(),
                b.getClaimCount(),
                b.getTotalAmount(),
                b.getFileName(),
                b.getAttempts(),
                b.getLastError(),
                b.getBankReference(),
                b.getCreatedBy().getId(),
                b.getCreatedBy().getName(),
                b.getCreatedAt(),
                b.getSentAt(),
                summaries
        );
    }
}
