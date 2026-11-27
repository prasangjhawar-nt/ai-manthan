package com.expenseflow.service;

import com.expenseflow.model.Claim;
import com.expenseflow.model.Employee;
import com.expenseflow.model.Role;
import com.expenseflow.repository.DelegationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** R13 / README 2.1 visibility (incl. R10 delegation) and NFR-SEC-4 upload checks. */
class VisibilityAndReceiptTest {

    DelegationRepository delegations;
    com.expenseflow.repository.ClaimRepository claims;
    ClaimService service;
    Employee head, auditor, manager, otherManager, delegate, employee, colleague;

    static Employee person(long id, Role role, Employee mgr) {
        Employee e = new Employee();
        e.setId(id);
        e.setRole(role);
        e.setManager(mgr);
        return e;
    }

    @BeforeEach
    void setUp() {
        delegations = mock(DelegationRepository.class);
        claims = mock(com.expenseflow.repository.ClaimRepository.class);
        service = new ClaimService(claims, null, null, null, null, null, null, null, delegations);
        head = person(1, Role.HEAD, null);
        auditor = person(2, Role.AUDITOR, head);
        manager = person(3, Role.MANAGER, head);
        otherManager = person(4, Role.MANAGER, head);
        delegate = person(5, Role.MANAGER, head);
        employee = person(6, Role.EMPLOYEE, manager);
        colleague = person(7, Role.EMPLOYEE, manager);
    }

    Claim claimOf(Employee owner) {
        Claim c = new Claim();
        c.setEmployee(owner);
        return c;
    }

    @Test
    void ownerSeesOwnClaim() {
        assertThat(service.canView(claimOf(employee), employee)).isTrue();
    }

    @Test
    @DisplayName("R13: an employee never sees a colleague's claim")
    void colleagueIsHidden() {
        assertThat(service.canView(claimOf(colleague), employee)).isFalse();
    }

    @Test
    void managerSeesDirectReportsOnly() {
        assertThat(service.canView(claimOf(employee), manager)).isTrue();
        assertThat(service.canView(claimOf(employee), otherManager)).isFalse();
    }

    @Test
    @DisplayName("R10: active delegate of the claimant's manager sees the claim")
    void activeDelegateSeesClaim() {
        when(delegations.isActiveDelegate(eq(3L), eq(5L), any())).thenReturn(true);
        assertThat(service.canView(claimOf(employee), delegate)).isTrue();
    }

    @Test
    void auditorAndHeadSeeAll() {
        assertThat(service.canView(claimOf(employee), auditor)).isTrue();
        assertThat(service.canView(claimOf(employee), head)).isTrue();
    }

    @Test
    @DisplayName("FR-APR-5: expired/future delegate still reaches the action (-> 403 there), a stranger gets 404")
    void loadForAction() {
        Claim c = claimOf(employee);
        when(claims.findByIdWithEmployee(9L)).thenReturn(java.util.Optional.of(c));
        when(delegations.existsByApprover_IdAndDelegate_Id(3L, 5L)).thenReturn(true);   // delegation exists, not active
        assertThat(service.loadForAction(9L, delegate)).isSameAs(c);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.loadForAction(9L, otherManager))
                .isInstanceOf(com.expenseflow.exception.ApiException.class)
                .satisfies(e -> assertThat(((com.expenseflow.exception.ApiException) e).status())
                        .isEqualTo(org.springframework.http.HttpStatus.NOT_FOUND));
    }

    @Test
    @DisplayName("NFR-SEC-4: declared type must match the file signature")
    void fileSignatures() {
        byte[] png = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A};
        byte[] jpg = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0};
        byte[] pdf = {'%', 'P', 'D', 'F', '-'};
        byte[] html = {'<', 'h', 't', 'm', 'l', '>'};
        assertThat(ReceiptService.matchesSignature("image/png", png)).isTrue();
        assertThat(ReceiptService.matchesSignature("image/jpeg", jpg)).isTrue();
        assertThat(ReceiptService.matchesSignature("application/pdf", pdf)).isTrue();
        assertThat(ReceiptService.matchesSignature("image/png", html)).isFalse();
        assertThat(ReceiptService.matchesSignature("application/pdf", png)).isFalse();
        assertThat(ReceiptService.matchesSignature("image/png", new byte[0])).isFalse();
    }

    @Test
    void fileNamesAreSanitised() {
        assertThat(ReceiptService.safeFileName("C:\\Users\\x\\bill.pdf")).isEqualTo("bill.pdf");
        assertThat(ReceiptService.safeFileName("../../etc/passwd")).isEqualTo("passwd");
        assertThat(ReceiptService.safeFileName("a\"b\r\n.png")).isEqualTo("a_b__.png");
        assertThat(ReceiptService.safeFileName(null)).isEqualTo("receipt");
        assertThat(ReceiptService.safeFileName("x".repeat(400) + ".pdf")).hasSize(200).endsWith(".pdf");
    }
}
