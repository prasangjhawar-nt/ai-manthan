package com.expenseflow.service;

import com.expenseflow.model.Category;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimLine;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.LineOutcome;
import com.expenseflow.model.PolicyRule;
import com.expenseflow.repository.ClaimLineRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.util.ArrayList;
import java.util.List;

/**
 * Evaluates every claim line against the rules in README section 4.3. All checks
 * run per line, flags are collected, and the line outcome follows precedence
 * AUTO_REJECT &gt; ROUTE &gt; AUTO_APPROVE. The claim outcome aggregates per section
 * 4.3.
 */
@Service
public class PolicyEngine {

    public static final String FLAG_OVER_LIMIT      = "OVER_LIMIT";
    public static final String FLAG_MISSING_RECEIPT = "MISSING_RECEIPT";
    public static final String FLAG_DUPLICATE       = "DUPLICATE";
    public static final String FLAG_WEEKEND         = "WEEKEND";
    public static final String FLAG_NO_POLICY       = "NO_POLICY";

    private final PolicyConfigCache cache;
    private final ClaimLineRepository lines;
    private final Counter autoApprove;
    private final Counter route;
    private final Counter autoReject;

    public PolicyEngine(PolicyConfigCache cache, ClaimLineRepository lines, MeterRegistry registry) {
        this.cache = cache;
        this.lines = lines;
        this.autoApprove = Counter.builder("expenseflow_policy_outcomes_total")
                .tag("outcome", "AUTO_APPROVE").register(registry);
        this.route = Counter.builder("expenseflow_policy_outcomes_total")
                .tag("outcome", "ROUTE").register(registry);
        this.autoReject = Counter.builder("expenseflow_policy_outcomes_total")
                .tag("outcome", "AUTO_REJECT").register(registry);
    }

    public Result evaluate(Claim claim) {
        PolicyConfigCache.Snapshot snap = cache.get();
        BigDecimal receiptRequiredAbove = snap.money("receipt.required.above");
        BigDecimal autoApproveMaxTotal  = snap.money("auto_approve.max_total");
        double sampleRate               = snap.doubleValue("sample_audit.rate");

        for (ClaimLine line : claim.getLines()) {
            evaluateLine(line, claim, snap, receiptRequiredAbove);
        }

        BigDecimal total = claim.getLines().stream()
                .map(ClaimLine::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        claim.setTotalAmount(total);

        boolean anyAutoReject = claim.getLines().stream().anyMatch(l -> l.getOutcome() == LineOutcome.AUTO_REJECT);
        boolean anyRoute      = claim.getLines().stream().anyMatch(l -> l.getOutcome() == LineOutcome.ROUTE);

        ClaimStatus target;
        boolean sampleAudit = false;
        if (anyAutoReject) {
            target = ClaimStatus.REJECTED;
            autoReject.increment();
        } else if (anyRoute || total.compareTo(autoApproveMaxTotal) > 0) {
            target = claim.getEmployee().getManager() != null
                    ? ClaimStatus.PENDING_MANAGER
                    : ClaimStatus.PENDING_AUDITOR;
            route.increment();
        } else {
            target = ClaimStatus.APPROVED;
            autoApprove.increment();
            // Deterministic 10% sample: claim_number hash. For first submit the number may
            // already be set; if not, caller has set it before evaluate(). Fall back to id.
            String key = claim.getClaimNumber() != null ? claim.getClaimNumber() : String.valueOf(claim.getId());
            if (Math.abs(key.hashCode()) % 100 < (int) Math.round(sampleRate * 100)) {
                sampleAudit = true;
            }
        }
        return new Result(target, sampleAudit);
    }

    private void evaluateLine(ClaimLine line, Claim claim,
                              PolicyConfigCache.Snapshot snap,
                              BigDecimal receiptRequiredAbove) {
        List<String> flags = new ArrayList<>();
        String reason = null;
        LineOutcome outcome = LineOutcome.AUTO_APPROVE;

        // R4: receipt mandatory above threshold -> AUTO_REJECT
        if (line.getAmount().compareTo(receiptRequiredAbove) > 0 && line.getReceipt() == null) {
            flags.add(FLAG_MISSING_RECEIPT);
            outcome = LineOutcome.AUTO_REJECT;
            reason = "Receipt required above " + receiptRequiredAbove.toPlainString() + " INR";
        }

        // R1/R2/R3: category over-limit
        OverLimitCheck ol = checkOverLimit(line, claim, snap);
        if (ol.triggered) {
            flags.add(FLAG_OVER_LIMIT);
            if (outcome != LineOutcome.AUTO_REJECT) {
                outcome = LineOutcome.ROUTE;
                if (reason == null) reason = ol.reason;
            }
        }

        // R5: duplicate (same-employee fields OR global hash)
        if (isDuplicate(line, claim)) {
            flags.add(FLAG_DUPLICATE);
            if (outcome != LineOutcome.AUTO_REJECT) {
                outcome = LineOutcome.ROUTE;
                if (reason == null) reason = "Duplicate of an earlier line";
            }
        }

        // R6: weekend
        DayOfWeek day = line.getExpenseDate().getDayOfWeek();
        if (day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY) {
            flags.add(FLAG_WEEKEND);
            if (outcome != LineOutcome.AUTO_REJECT) {
                outcome = LineOutcome.ROUTE;
                if (reason == null) reason = "Expense on a " + (day == DayOfWeek.SATURDAY ? "Saturday" : "Sunday");
            }
        }

        // No category rule -> NO_POLICY (unless already AUTO_REJECT)
        if (outcome != LineOutcome.AUTO_REJECT && !categoryHasRule(line.getCategory(), snap)) {
            if (!flags.contains(FLAG_NO_POLICY)) flags.add(FLAG_NO_POLICY);
            outcome = LineOutcome.ROUTE;
            if (reason == null) reason = "No auto-approve policy for " + line.getCategory();
        }

        line.setOutcome(outcome);
        line.setFlags(flags);
        line.setReason(reason);
    }

    private boolean categoryHasRule(Category c, PolicyConfigCache.Snapshot snap) {
        return snap.rules().stream().anyMatch(r -> r.getCategory() == c);
    }

    private record OverLimitCheck(boolean triggered, String reason) {}

    private OverLimitCheck checkOverLimit(ClaimLine line, Claim claim, PolicyConfigCache.Snapshot snap) {
        return switch (line.getCategory()) {
            case MEALS -> {
                BigDecimal limit = ruleLimit(snap, "MEAL_DAILY");
                if (limit == null) yield new OverLimitCheck(false, null);
                BigDecimal priorSum = lines.sumMealsForEmployeeOnDate(
                        claim.getEmployee().getId(),
                        line.getExpenseDate(),
                        claim.getId());
                // Include lines in THIS claim on the same date (the line itself and siblings)
                BigDecimal siblingSum = claim.getLines().stream()
                        .filter(l -> l.getCategory() == Category.MEALS)
                        .filter(l -> l.getExpenseDate().equals(line.getExpenseDate()))
                        .map(ClaimLine::getAmount)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
                BigDecimal total = priorSum.add(siblingSum);
                if (total.compareTo(limit) > 0) {
                    yield new OverLimitCheck(true,
                            "Meals total " + total.toPlainString() + " exceeds daily limit of " + limit.toPlainString());
                }
                yield new OverLimitCheck(false, null);
            }
            case HOTEL -> {
                boolean tier1 = line.getCity() != null && snap.tier1Cities().contains(line.getCity());
                BigDecimal limit = ruleLimit(snap, tier1 ? "HOTEL_T1" : "HOTEL_OTHER");
                if (limit == null || line.getNights() == null || line.getNights() == 0) {
                    yield new OverLimitCheck(false, null);
                }
                BigDecimal perNight = line.getAmount().divide(BigDecimal.valueOf(line.getNights()), 2, java.math.RoundingMode.HALF_UP);
                if (perNight.compareTo(limit) > 0) {
                    yield new OverLimitCheck(true,
                            perNight.toPlainString() + " per night is above the " + (tier1 ? "tier-1 " : "") + "limit of " + limit.toPlainString());
                }
                yield new OverLimitCheck(false, null);
            }
            case LOCAL_CAB -> {
                BigDecimal limit = ruleLimit(snap, "CAB_TRIP");
                if (limit == null) yield new OverLimitCheck(false, null);
                if (line.getAmount().compareTo(limit) > 0) {
                    yield new OverLimitCheck(true,
                            line.getAmount().toPlainString() + " exceeds cab limit of " + limit.toPlainString());
                }
                yield new OverLimitCheck(false, null);
            }
            default -> new OverLimitCheck(false, null);
        };
    }

    private BigDecimal ruleLimit(PolicyConfigCache.Snapshot snap, String code) {
        return snap.rules().stream()
                .filter(r -> r.getCode().equals(code))
                .map(PolicyRule::getLimitAmount)
                .findFirst().orElse(null);
    }

    private boolean isDuplicate(ClaimLine line, Claim claim) {
        var byFields = lines.findDuplicatesByFields(
                claim.getEmployee().getId(), line.getVendor(), line.getAmount(),
                line.getExpenseDate(), claim.getId());
        if (!byFields.isEmpty()) return true;
        // Same-claim duplicates (earlier line_no)
        for (ClaimLine sibling : claim.getLines()) {
            if (sibling == line) continue;
            if (sibling.getLineNo() >= line.getLineNo()) continue;
            if (sibling.getVendor() != null && sibling.getVendor().trim().equalsIgnoreCase(line.getVendor().trim())
                    && sibling.getAmount().compareTo(line.getAmount()) == 0
                    && sibling.getExpenseDate().equals(line.getExpenseDate())) {
                return true;
            }
        }
        if (line.getReceipt() != null) {
            var byHash = lines.findDuplicatesByReceiptHash(line.getReceipt().getSha256(), claim.getId());
            if (!byHash.isEmpty()) return true;
        }
        return false;
    }

    public record Result(ClaimStatus targetStatus, boolean sampleAudit) {}
}
