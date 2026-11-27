package com.expenseflow.service;

import com.expenseflow.exception.ApiException;
import com.expenseflow.model.ClaimStatus;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Explicit table of valid transitions per README §5. */
class StatusFlowTest {

    @ParameterizedTest(name = "{0} -> {1} allowed")
    @CsvSource({
            "DRAFT, SUBMITTED",
            "SUBMITTED, REJECTED",
            "SUBMITTED, APPROVED",
            "SUBMITTED, PENDING_MANAGER",
            "SUBMITTED, PENDING_AUDITOR",
            "PENDING_MANAGER, APPROVED",
            "PENDING_MANAGER, PENDING_AUDITOR",
            "PENDING_MANAGER, NEEDS_CLARIFICATION",
            "PENDING_MANAGER, REJECTED",
            "PENDING_AUDITOR, APPROVED",
            "PENDING_AUDITOR, PENDING_HEAD",
            "PENDING_AUDITOR, NEEDS_CLARIFICATION",
            "PENDING_AUDITOR, REJECTED",
            "PENDING_HEAD, APPROVED",
            "PENDING_HEAD, NEEDS_CLARIFICATION",
            "PENDING_HEAD, REJECTED",
            "NEEDS_CLARIFICATION, SUBMITTED",
            "APPROVED, REJECTED",
            "APPROVED, IN_PAYOUT",
            "IN_PAYOUT, PAID"
    })
    @DisplayName("Valid transitions pass")
    void validTransitions(ClaimStatus from, ClaimStatus to) {
        StatusFlow.assertTransition(from, to);  // must not throw
    }

    @ParameterizedTest(name = "{0} -> {1} rejected")
    @CsvSource({
            "DRAFT, APPROVED",
            "DRAFT, PENDING_MANAGER",
            "PENDING_MANAGER, PAID",
            "PENDING_MANAGER, PENDING_HEAD",
            "APPROVED, APPROVED",
            "REJECTED, SUBMITTED",
            "PAID, REJECTED",
            "PAID, APPROVED",
            "NEEDS_CLARIFICATION, APPROVED",
            "IN_PAYOUT, APPROVED"
    })
    @DisplayName("Invalid transitions throw 409 ApiException")
    void invalidTransitions(ClaimStatus from, ClaimStatus to) {
        assertThatThrownBy(() -> StatusFlow.assertTransition(from, to))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).status().value()).isEqualTo(409));
    }
}
