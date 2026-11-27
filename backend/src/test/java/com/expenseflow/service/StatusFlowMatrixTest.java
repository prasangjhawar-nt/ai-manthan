package com.expenseflow.service;

import com.expenseflow.exception.ApiException;
import com.expenseflow.model.ClaimStatus;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpStatus;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import static com.expenseflow.model.ClaimStatus.*;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * README section 5: every transition in the table is allowed, every other pair is a 409.
 * The expected table is written out here independently of StatusFlow on purpose.
 */
class StatusFlowMatrixTest {

    static final Map<ClaimStatus, Set<ClaimStatus>> README_TABLE = Map.of(
            DRAFT, EnumSet.of(SUBMITTED),
            SUBMITTED, EnumSet.of(REJECTED, APPROVED, PENDING_MANAGER, PENDING_AUDITOR),
            PENDING_MANAGER, EnumSet.of(APPROVED, PENDING_AUDITOR, NEEDS_CLARIFICATION, REJECTED),
            PENDING_AUDITOR, EnumSet.of(APPROVED, PENDING_HEAD, NEEDS_CLARIFICATION, REJECTED),
            PENDING_HEAD, EnumSet.of(APPROVED, NEEDS_CLARIFICATION, REJECTED),
            NEEDS_CLARIFICATION, EnumSet.of(SUBMITTED),
            APPROVED, EnumSet.of(REJECTED, IN_PAYOUT),
            IN_PAYOUT, EnumSet.of(PAID),
            REJECTED, EnumSet.noneOf(ClaimStatus.class),
            PAID, EnumSet.noneOf(ClaimStatus.class));

    static Stream<Arguments> allowed() {
        List<Arguments> out = new ArrayList<>();
        README_TABLE.forEach((from, tos) -> tos.forEach(to -> out.add(Arguments.of(from, to))));
        return out.stream();
    }

    static Stream<Arguments> forbidden() {
        List<Arguments> out = new ArrayList<>();
        for (ClaimStatus from : ClaimStatus.values()) {
            for (ClaimStatus to : ClaimStatus.values()) {
                if (!README_TABLE.getOrDefault(from, Set.of()).contains(to)) out.add(Arguments.of(from, to));
            }
        }
        return out.stream();
    }

    @ParameterizedTest(name = "{0} -> {1} allowed")
    @MethodSource("allowed")
    void allowedTransitions(ClaimStatus from, ClaimStatus to) {
        assertThatCode(() -> StatusFlow.assertTransition(from, to)).doesNotThrowAnyException();
    }

    @ParameterizedTest(name = "{0} -> {1} is 409")
    @MethodSource("forbidden")
    void forbiddenTransitions(ClaimStatus from, ClaimStatus to) {
        assertThatThrownBy(() -> StatusFlow.assertTransition(from, to))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> org.assertj.core.api.Assertions.assertThat(((ApiException) e).status())
                        .isEqualTo(HttpStatus.CONFLICT));
    }
}
