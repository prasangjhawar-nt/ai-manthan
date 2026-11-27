package com.expenseflow.service;

import com.expenseflow.dto.ClaimSummaryDto;
import com.expenseflow.dto.DashboardSummaryDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Category;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimLine;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Role;
import com.expenseflow.repository.ClaimRepository;
import com.expenseflow.security.CurrentUser;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class DashboardService {

    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("yyyy-MM");

    private final ClaimRepository claims;
    private final CurrentUser current;
    private final ClaimService claimService;

    public DashboardService(ClaimRepository claims, CurrentUser current, ClaimService claimService) {
        this.claims = claims;
        this.current = current;
        this.claimService = claimService;
    }

    @Transactional(readOnly = true)
    public DashboardSummaryDto summary(LocalDate from, LocalDate to) {
        Role role = current.role();
        if (role != Role.AUDITOR && role != Role.HEAD) {
            throw ApiException.forbidden("Role not allowed");
        }
        LocalDate today = LocalDate.now();
        if (to == null) to = today;
        if (from == null) from = to.minusMonths(12);

        Instant fromI = from.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant toI   = to.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();

        // Pending counts by level
        Map<String, Integer> pendingByLevel = new LinkedHashMap<>();
        pendingByLevel.put("MANAGER", count(ClaimStatus.PENDING_MANAGER));
        pendingByLevel.put("AUDITOR", count(ClaimStatus.PENDING_AUDITOR));
        pendingByLevel.put("HEAD",    count(ClaimStatus.PENDING_HEAD));

        // Oldest pending
        Double oldestHours = oldestPendingHours();

        // Period claims (status in APPROVED/IN_PAYOUT/PAID + REJECTED touched here? dashboards show spend only on paid-ish)
        Specification<Claim> spec = (r, q, cb) -> cb.and(
                cb.greaterThanOrEqualTo(r.get("submittedAt"), fromI),
                cb.lessThan(r.get("submittedAt"), toI)
        );
        List<Claim> period = claims.findAll(spec);

        int violations = 0;
        Map<String, Integer> flagCounts = new LinkedHashMap<>();
        Map<Category, BigDecimal> byCategory = new LinkedHashMap<>();
        Map<Long, DashboardSummaryDto.DepartmentAmount> byDept = new LinkedHashMap<>();
        Map<String, BigDecimal> byMonth = new LinkedHashMap<>();
        BigDecimal totalPaid = BigDecimal.ZERO;
        long approvedCount = 0;
        long approvalMillisSum = 0L;

        for (Claim c : period) {
            boolean paidLike = c.getStatus() == ClaimStatus.APPROVED
                    || c.getStatus() == ClaimStatus.IN_PAYOUT
                    || c.getStatus() == ClaimStatus.PAID;
            for (ClaimLine l : c.getLines()) {
                if (!l.getFlags().isEmpty()) violations++;
                for (String f : l.getFlags()) flagCounts.merge(f, 1, Integer::sum);
                if (paidLike) {
                    byCategory.merge(l.getCategory(), l.getAmount(), BigDecimal::add);
                }
            }
            if (paidLike) {
                var dept = c.getEmployee().getDepartment();
                byDept.merge(dept.getId(),
                        new DashboardSummaryDto.DepartmentAmount(dept.getId(), dept.getName(), c.getTotalAmount()),
                        (a, b) -> new DashboardSummaryDto.DepartmentAmount(a.departmentId(), a.departmentName(),
                                a.amount().add(b.amount())));
                String month = c.getSubmittedAt().atZone(ZoneOffset.UTC).toLocalDate().format(MONTH);
                byMonth.merge(month, c.getTotalAmount(), BigDecimal::add);
            }
            if (c.getStatus() == ClaimStatus.PAID) {
                totalPaid = totalPaid.add(c.getTotalAmount());
            }
            if (c.getFinalDecisionAt() != null && c.getSubmittedAt() != null) {
                approvedCount++;
                approvalMillisSum += c.getFinalDecisionAt().toEpochMilli() - c.getSubmittedAt().toEpochMilli();
            }
        }

        Double avgApprovalHours = approvedCount == 0 ? null : (approvalMillisSum / (double) approvedCount) / 3_600_000.0;

        List<DashboardSummaryDto.CategoryAmount> spendByCategory = new ArrayList<>();
        byCategory.forEach((k, v) -> spendByCategory.add(new DashboardSummaryDto.CategoryAmount(k.name(), v)));
        spendByCategory.sort((a, b) -> b.amount().compareTo(a.amount()));

        List<DashboardSummaryDto.DepartmentAmount> spendByDepartment = new ArrayList<>(byDept.values());
        spendByDepartment.sort((a, b) -> b.amount().compareTo(a.amount()));

        List<DashboardSummaryDto.MonthAmount> spendByMonth = new ArrayList<>();
        byMonth.forEach((k, v) -> spendByMonth.add(new DashboardSummaryDto.MonthAmount(k, v)));
        spendByMonth.sort((a, b) -> a.month().compareTo(b.month()));

        List<DashboardSummaryDto.FlagCount> violationsByFlag = new ArrayList<>();
        flagCounts.forEach((k, v) -> violationsByFlag.add(new DashboardSummaryDto.FlagCount(k, v)));
        violationsByFlag.sort((a, b) -> Integer.compare(b.count(), a.count()));

        List<Claim> oldest = claims.findAll(
                (r, q, cb) -> r.get("status").in(
                        ClaimStatus.PENDING_MANAGER, ClaimStatus.PENDING_AUDITOR, ClaimStatus.PENDING_HEAD),
                PageRequest.of(0, 10, Sort.by(Sort.Direction.ASC, "submittedAt"))
        ).getContent();
        List<ClaimSummaryDto> exceptions = oldest.stream()
                .map(c -> ClaimSummaryDto.from(c, claimService.waitingHours(c))).toList();

        return new DashboardSummaryDto(
                from, to,
                new DashboardSummaryDto.Kpis(pendingByLevel, oldestHours, violations, avgApprovalHours, totalPaid),
                spendByCategory, spendByDepartment, spendByMonth, violationsByFlag, exceptions
        );
    }

    private int count(ClaimStatus status) {
        return (int) claims.count((r, q, cb) -> cb.equal(r.get("status"), status));
    }

    private Double oldestPendingHours() {
        List<Claim> oldest = claims.findAll(
                (r, q, cb) -> r.get("status").in(
                        ClaimStatus.PENDING_MANAGER, ClaimStatus.PENDING_AUDITOR, ClaimStatus.PENDING_HEAD),
                PageRequest.of(0, 1, Sort.by(Sort.Direction.ASC, "submittedAt"))
        ).getContent();
        if (oldest.isEmpty()) return null;
        Instant since = oldest.get(0).getSubmittedAt();
        if (since == null) return null;
        return (Instant.now().toEpochMilli() - since.toEpochMilli()) / 3_600_000.0;
    }
}
