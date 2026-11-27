package com.expenseflow.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

public record DashboardSummaryDto(
        LocalDate from,
        LocalDate to,
        Kpis kpis,
        List<CategoryAmount> spendByCategory,
        List<DepartmentAmount> spendByDepartment,
        List<MonthAmount> spendByMonth,
        List<FlagCount> violationsByFlag,
        List<ClaimSummaryDto> exceptions
) {
    public record Kpis(
            Map<String, Integer> pendingByLevel,
            Double oldestPendingHours,
            int policyViolations,
            Double avgApprovalHours,
            BigDecimal totalPaid
    ) {}
    public record CategoryAmount(String category, BigDecimal amount) {}
    public record DepartmentAmount(Long departmentId, String departmentName, BigDecimal amount) {}
    public record MonthAmount(String month, BigDecimal amount) {}
    public record FlagCount(String flag, int count) {}
}
