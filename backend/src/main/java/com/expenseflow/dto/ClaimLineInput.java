package com.expenseflow.dto;

import com.expenseflow.model.Category;
import jakarta.validation.constraints.*;

import java.math.BigDecimal;
import java.time.LocalDate;

public record ClaimLineInput(
        @NotNull Category category,
        @NotNull LocalDate expenseDate,
        @NotNull @DecimalMin(value = "0.01") @DecimalMax(value = "1000000.00") BigDecimal amount,
        @NotBlank @Size(min = 1, max = 120) String vendor,
        @Size(max = 80) String city,
        @Min(1) @Max(30) Integer nights,
        @Size(max = 500) String description,
        Long receiptId
) {}
