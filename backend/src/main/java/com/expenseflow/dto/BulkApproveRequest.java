package com.expenseflow.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record BulkApproveRequest(
        @NotNull @Size(min = 1, max = 100) List<Long> claimIds,
        @Size(max = 1000) String comment
) {}
