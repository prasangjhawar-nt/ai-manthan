package com.expenseflow.service;

import com.expenseflow.exception.ApiException;
import com.expenseflow.model.ClaimStatus;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Canonical state machine from README section 5. Every transition either appears
 * in this table or raises a 409.
 */
public final class StatusFlow {

    private static final Map<ClaimStatus, Set<ClaimStatus>> ALLOWED = Map.ofEntries(
            Map.entry(ClaimStatus.DRAFT,                EnumSet.of(ClaimStatus.SUBMITTED)),
            Map.entry(ClaimStatus.SUBMITTED,            EnumSet.of(
                    ClaimStatus.REJECTED, ClaimStatus.APPROVED,
                    ClaimStatus.PENDING_MANAGER, ClaimStatus.PENDING_AUDITOR)),
            Map.entry(ClaimStatus.PENDING_MANAGER,      EnumSet.of(
                    ClaimStatus.APPROVED, ClaimStatus.PENDING_AUDITOR,
                    ClaimStatus.NEEDS_CLARIFICATION, ClaimStatus.REJECTED)),
            Map.entry(ClaimStatus.PENDING_AUDITOR,      EnumSet.of(
                    ClaimStatus.APPROVED, ClaimStatus.PENDING_HEAD,
                    ClaimStatus.NEEDS_CLARIFICATION, ClaimStatus.REJECTED)),
            Map.entry(ClaimStatus.PENDING_HEAD,         EnumSet.of(
                    ClaimStatus.APPROVED, ClaimStatus.NEEDS_CLARIFICATION, ClaimStatus.REJECTED)),
            Map.entry(ClaimStatus.NEEDS_CLARIFICATION,  EnumSet.of(ClaimStatus.SUBMITTED)),
            Map.entry(ClaimStatus.APPROVED,             EnumSet.of(ClaimStatus.REJECTED, ClaimStatus.IN_PAYOUT)),
            Map.entry(ClaimStatus.IN_PAYOUT,            EnumSet.of(ClaimStatus.PAID)),
            Map.entry(ClaimStatus.REJECTED,             EnumSet.noneOf(ClaimStatus.class)),
            Map.entry(ClaimStatus.PAID,                 EnumSet.noneOf(ClaimStatus.class))
    );

    private StatusFlow() {}

    public static void assertTransition(ClaimStatus from, ClaimStatus to) {
        Set<ClaimStatus> allowed = ALLOWED.getOrDefault(from, Set.of());
        if (!allowed.contains(to)) {
            throw ApiException.conflict("Cannot transition from " + from + " to " + to);
        }
    }

    public static void assertAction(ClaimStatus status, String action, Set<ClaimStatus> allowedFrom) {
        if (!allowedFrom.contains(status)) {
            throw ApiException.conflict("Action " + action + " is not allowed in status " + status);
        }
    }
}
