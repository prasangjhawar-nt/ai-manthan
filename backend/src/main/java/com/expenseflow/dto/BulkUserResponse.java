package com.expenseflow.dto;

import java.util.List;

public record BulkUserResponse(int processed, int succeeded, int failed, List<Result> results) {

    public record Result(
            int row,                      // 1-based CSV row index (header = row 1, first data row = 2)
            String employeeCode,
            String email,
            String outcome,               // CREATED | SKIPPED
            Long userId,                  // null on skip
            String temporaryPassword,     // present only on CREATED
            Integer errorStatus,          // 400 / 409 on SKIPPED
            String errorDetail
    ) {}
}
