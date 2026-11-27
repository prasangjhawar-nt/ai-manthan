package com.expenseflow.dto;

import java.time.Instant;

public record ReceiptUploadDto(
        Long id,
        String fileName,
        String contentType,
        int sizeBytes,
        String sha256,
        Long duplicateOfReceiptId,
        Instant uploadedAt
) {}
