package com.expenseflow.dto;

import com.expenseflow.model.Role;
import jakarta.validation.constraints.*;

public record CreateUserRequest(
        @NotBlank @Size(min = 2, max = 32) @Pattern(regexp = "^[A-Za-z0-9_-]+$") String employeeCode,
        @NotBlank @Size(min = 2, max = 128) String name,
        @NotBlank @Email @Size(max = 190) String email,
        @NotNull Role role,
        @NotNull Long departmentId,
        Long managerId,                   // null for HEAD or root managers
        @NotBlank @Size(min = 9, max = 32) @Pattern(regexp = "^[0-9]+$") String accountNumber,
        @NotBlank @Size(min = 11, max = 11) @Pattern(regexp = "^[A-Z]{4}0[A-Z0-9]{6}$") String ifsc
) {}
