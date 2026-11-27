package com.expenseflow.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record ClaimUpdateRequest(
        @NotNull Long version,
        @NotBlank @Size(min = 1, max = 120) String title,
        @Size(min = 1, max = 20) @Valid List<ClaimLineInput> lines
) {}
