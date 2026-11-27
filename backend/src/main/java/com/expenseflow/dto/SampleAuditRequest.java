package com.expenseflow.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record SampleAuditRequest(
        @NotNull Result result,
        @Size(max = 1000) String reason
) {
    public enum Result { CLEARED, FAILED }
}
