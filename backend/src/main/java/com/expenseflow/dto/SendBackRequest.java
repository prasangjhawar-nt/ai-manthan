package com.expenseflow.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SendBackRequest(@NotBlank @Size(min = 1, max = 1000) String comment) {}
