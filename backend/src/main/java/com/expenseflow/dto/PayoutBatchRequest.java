package com.expenseflow.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

public record PayoutBatchRequest(@NotNull @Size(min = 1, max = 500) List<Long> claimIds) {}
