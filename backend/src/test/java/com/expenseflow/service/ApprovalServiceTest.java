package com.expenseflow.service;

import com.expenseflow.exception.ApiException;
import com.expenseflow.model.ApprovalLevel;
import com.expenseflow.model.ApprovalStep;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Employee;
import com.expenseflow.model.Role;
import com.expenseflow.repository.ApprovalStepRepository;
import com.expenseflow.repository.ClaimRepository;
import com.expenseflow.repository.DelegationRepository;
import com.expenseflow.security.CurrentUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Approval chain R9 thresholds (strict "above"), R15 self-approval, R10 delegation, A11. */
class ApprovalServiceTest {

    ClaimRepository claims;
    ApprovalStepRepository steps;
    DelegationRepository delegations;
    CurrentUser current;
    AuditService audit;
    ClaimService claimService;
    IdempotencyService idem;
    PolicyConfigCache cache;
    ApprovalService service;

    Employee head, auditor, manager, delegate, employee;

    @BeforeEach
    void setUp() {
        claims = mock(ClaimRepository.class);
        steps = mock(ApprovalStepRepository.class);
        delegations = mock(DelegationRepository.class);
        current = mock(CurrentUser.class);
        audit = mock(AuditService.class);
        claimService = mock(ClaimService.class);
        idem = mock(IdempotencyService.class);
        cache = mock(PolicyConfigCache.class);
        when(cache.get()).thenReturn(PolicyEngineTest.snapshot());
        when(claims.save(any(Claim.class))).thenAnswer(inv -> inv.getArgument(0));
        service = new ApprovalService(claims, steps, delegations, current, audit, claimService, idem, cache);
        service.setTransactionManager(mock(org.springframework.transaction.PlatformTransactionManager.class));

        head = person(1L, Role.HEAD, null);
        auditor = person(2L, Role.AUDITOR, head);
        manager = person(3L, Role.MANAGER, head);
        delegate = person(4L, Role.MANAGER, head);
        employee = person(5L, Role.EMPLOYEE, manager);
    }

    static Employee person(Long id, Role role, Employee mgr) {
        Employee e = new Employee();
        e.setId(id);
        e.setRole(role);
        e.setManager(mgr);
        return e;
    }

    Claim pending(Employee owner, ClaimStatus status, String total) {
        Claim c = new Claim();
        c.setId(42L);
        c.setEmployee(owner);
        c.setStatus(status);
        c.setTotalAmount(new BigDecimal(total));
        when(claimService.loadForAction(eq(42L), any())).thenReturn(c);
        when(claimService.loadVisible(eq(42L), any())).thenReturn(c);
        return c;
    }

    void actingAs(Employee e) {
        when(current.employee()).thenReturn(e);
    }

    @ParameterizedTest(name = "manager approves {0} -> {1}")
    @CsvSource({"25000.00, APPROVED", "25000.01, PENDING_AUDITOR"})
    void managerThreshold(String total, ClaimStatus expected) {
        Claim c = pending(employee, ClaimStatus.PENDING_MANAGER, total);
        actingAs(manager);
        service.approve(42L, null);
        assertThat(c.getStatus()).isEqualTo(expected);
        assertThat(c.getFinalDecisionAt() != null).isEqualTo(expected == ClaimStatus.APPROVED);
    }

    @ParameterizedTest(name = "auditor approves {0} -> {1}")
    @CsvSource({"100000.00, APPROVED", "100000.01, PENDING_HEAD"})
    void auditorThreshold(String total, ClaimStatus expected) {
        Claim c = pending(employee, ClaimStatus.PENDING_AUDITOR, total);
        actingAs(auditor);
        service.approve(42L, null);
        assertThat(c.getStatus()).isEqualTo(expected);
    }

    @Test
    void headApprovesToApproved() {
        Claim c = pending(employee, ClaimStatus.PENDING_HEAD, "150000.00");
        actingAs(head);
        service.approve(42L, "ok");
        assertThat(c.getStatus()).isEqualTo(ClaimStatus.APPROVED);
    }

    @Test
    @DisplayName("A11: HEAD's own claim above 1,00,000 ends at AUDITOR (no second head)")
    void headOwnClaimStopsAtAuditor() {
        Claim c = pending(head, ClaimStatus.PENDING_AUDITOR, "150000.00");
        actingAs(auditor);
        service.approve(42L, null);
        assertThat(c.getStatus()).isEqualTo(ClaimStatus.APPROVED);
    }

    @Test
    @DisplayName("R15: nobody approves their own claim -> 403, nothing written")
    void selfApprovalForbidden() {
        pending(manager, ClaimStatus.PENDING_MANAGER, "1000.00");
        actingAs(manager);
        assertThatThrownBy(() -> service.approve(42L, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(HttpStatus.FORBIDDEN));
        verify(steps, never()).save(any());
    }

    @Test
    @DisplayName("Wrong role at a level -> 403")
    void employeeCannotActAtAuditorLevel() {
        pending(employee, ClaimStatus.PENDING_AUDITOR, "30000.00");
        actingAs(manager);
        assertThatThrownBy(() -> service.approve(42L, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    @DisplayName("R10: active delegate acts for the manager; step stores both people")
    void activeDelegate() {
        Claim c = pending(employee, ClaimStatus.PENDING_MANAGER, "1000.00");
        actingAs(delegate);
        when(delegations.isActiveDelegate(eq(3L), eq(4L), any())).thenReturn(true);

        service.approve(42L, null);

        ArgumentCaptor<ApprovalStep> step = ArgumentCaptor.forClass(ApprovalStep.class);
        verify(steps).save(step.capture());
        assertThat(step.getValue().getLevel()).isEqualTo(ApprovalLevel.MANAGER);
        assertThat(step.getValue().getApprover()).isSameAs(manager);
        assertThat(step.getValue().getActedBy()).isSameAs(delegate);
        assertThat(c.getStatus()).isEqualTo(ClaimStatus.APPROVED);
    }

    @Test
    @DisplayName("R10: expired or future delegation -> 403")
    void inactiveDelegate() {
        pending(employee, ClaimStatus.PENDING_MANAGER, "1000.00");
        actingAs(delegate);
        when(delegations.isActiveDelegate(anyLong(), anyLong(), any())).thenReturn(false);
        assertThatThrownBy(() -> service.approve(42L, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    @DisplayName("R15: an auditor cannot resolve the sample audit of their own claim")
    void sampleAuditOwnClaimForbidden() {
        Claim c = pending(auditor, ClaimStatus.APPROVED, "3000.00");
        c.setSampleAudit(com.expenseflow.model.SampleAuditStatus.OPEN);
        actingAs(auditor);
        assertThatThrownBy(() -> service.resolveSampleAudit(42L,
                new com.expenseflow.dto.SampleAuditRequest(com.expenseflow.dto.SampleAuditRequest.Result.CLEARED, null)))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(HttpStatus.FORBIDDEN));
        assertThat(c.getSampleAudit()).isEqualTo(com.expenseflow.model.SampleAuditStatus.OPEN);
    }

    @Test
    void sendBackNeedsComment() {
        assertThatThrownBy(() -> service.sendBack(42L, " "))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void rejectNeedsReason() {
        assertThatThrownBy(() -> service.reject(42L, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    @DisplayName("Approve on a claim that is not pending -> 409")
    void approveApprovedClaimIsConflict() {
        pending(employee, ClaimStatus.APPROVED, "1000.00");
        actingAs(manager);
        assertThatThrownBy(() -> service.approve(42L, null))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).status()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    @DisplayName("Bulk approve (AUDITOR): per-claim results, 409 for wrong status, 403 for own claim")
    void bulkApprove() {
        Claim ok = new Claim();
        ok.setId(1L); ok.setEmployee(employee); ok.setStatus(ClaimStatus.PENDING_AUDITOR); ok.setTotalAmount(new BigDecimal("30000"));
        Claim big = new Claim();
        big.setId(2L); big.setEmployee(employee); big.setStatus(ClaimStatus.PENDING_AUDITOR); big.setTotalAmount(new BigDecimal("100000.01"));
        Claim wrong = new Claim();
        wrong.setId(3L); wrong.setEmployee(employee); wrong.setStatus(ClaimStatus.PENDING_MANAGER); wrong.setTotalAmount(BigDecimal.TEN);
        Claim own = new Claim();
        own.setId(4L); own.setEmployee(auditor); own.setStatus(ClaimStatus.PENDING_AUDITOR); own.setTotalAmount(new BigDecimal("30000"));
        when(claims.findByIdWithEmployee(1L)).thenReturn(java.util.Optional.of(ok));
        when(claims.findByIdWithEmployee(2L)).thenReturn(java.util.Optional.of(big));
        when(claims.findByIdWithEmployee(3L)).thenReturn(java.util.Optional.of(wrong));
        when(claims.findByIdWithEmployee(4L)).thenReturn(java.util.Optional.of(own));
        when(claims.findByIdWithEmployee(5L)).thenReturn(java.util.Optional.empty());
        when(idem.findExisting(any(), any())).thenReturn(java.util.Optional.empty());
        actingAs(auditor);

        var res = service.bulkApprove(List.of(1L, 2L, 3L, 4L, 5L), null, "k-1");

        assertThat(ok.getStatus()).isEqualTo(ClaimStatus.APPROVED);
        assertThat(big.getStatus()).isEqualTo(ClaimStatus.PENDING_HEAD);
        assertThat(wrong.getStatus()).isEqualTo(ClaimStatus.PENDING_MANAGER);
        assertThat(own.getStatus()).isEqualTo(ClaimStatus.PENDING_AUDITOR);
        assertThat(res.results()).extracting(com.expenseflow.dto.BulkApproveResponse.Result::errorStatus)
                .containsExactly(null, null, 409, 403, 404);
        assertThat(res.succeeded()).isEqualTo(2);
        assertThat(res.failed()).isEqualTo(3);
    }
}
