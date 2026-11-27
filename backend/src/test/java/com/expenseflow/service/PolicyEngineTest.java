package com.expenseflow.service;

import com.expenseflow.model.AppSetting;
import com.expenseflow.model.Category;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimLine;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Employee;
import com.expenseflow.model.LineOutcome;
import com.expenseflow.model.PolicyRule;
import com.expenseflow.model.Receipt;
import com.expenseflow.repository.ClaimLineRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Policy rules R1–R8, R16 with the boundaries from README section 12.
 * Pure unit test: config snapshot and repository are stubbed, no Spring context.
 */
class PolicyEngineTest {

    static final LocalDate WEDNESDAY = LocalDate.of(2026, 11, 25);
    static final LocalDate SATURDAY  = LocalDate.of(2026, 11, 21);
    static final LocalDate SUNDAY    = LocalDate.of(2026, 11, 22);

    PolicyConfigCache cache;
    ClaimLineRepository lines;
    PolicyEngine engine;
    SimpleMeterRegistry registry;
    Employee manager;
    Employee employee;
    int receiptSeq;

    @BeforeEach
    void setUp() {
        cache = mock(PolicyConfigCache.class);
        lines = mock(ClaimLineRepository.class);
        registry = new SimpleMeterRegistry();
        when(cache.get()).thenReturn(snapshot());
        when(lines.sumMealsForEmployeeOnDate(anyLong(), any(), any())).thenReturn(BigDecimal.ZERO);
        when(lines.findDuplicatesByFields(anyLong(), anyString(), any(), any(), any())).thenReturn(List.of());
        when(lines.findDuplicatesByReceiptHash(anyString(), any())).thenReturn(List.of());
        engine = new PolicyEngine(cache, lines, registry);

        manager = employee(1L, null);
        employee = employee(2L, manager);
    }

    // ------------------------------------------------------------------ helpers

    static PolicyConfigCache.Snapshot snapshot() {
        List<PolicyRule> rules = List.of(
                rule("MEAL_DAILY", Category.MEALS, "1500"),
                rule("HOTEL_T1", Category.HOTEL, "6000"),
                rule("HOTEL_OTHER", Category.HOTEL, "4000"),
                rule("CAB_TRIP", Category.LOCAL_CAB, "2000"));
        Map<String, String> settings = Map.of(
                "receipt.required.above", "500",
                "auto_approve.max_total", "5000",
                "approval.auditor.above", "25000",
                "approval.head.above", "100000",
                "sample_audit.rate", "0.10");
        Set<String> tier1 = Set.of("Mumbai", "Delhi", "Bengaluru", "Chennai", "Kolkata", "Hyderabad", "Pune", "Ahmedabad");
        return new PolicyConfigCache.Snapshot(Instant.now(), rules, List.<AppSetting>of(), tier1, settings);
    }

    static PolicyRule rule(String code, Category c, String limit) {
        PolicyRule r = new PolicyRule();
        r.setCode(code);
        r.setCategory(c);
        r.setLimitAmount(new BigDecimal(limit));
        r.setActive(true);
        return r;
    }

    static Employee employee(Long id, Employee mgr) {
        Employee e = new Employee();
        e.setId(id);
        e.setManager(mgr);
        return e;
    }

    Receipt receipt() {
        Receipt r = new Receipt();
        r.setId((long) ++receiptSeq);
        r.setSha256(String.format("%064x", receiptSeq));
        return r;
    }

    ClaimLine line(Category c, String amount, LocalDate date, boolean withReceipt) {
        ClaimLine l = new ClaimLine();
        l.setCategory(c);
        l.setAmount(new BigDecimal(amount));
        l.setExpenseDate(date);
        l.setVendor("Vendor " + c + " " + amount);
        if (withReceipt) l.setReceipt(receipt());
        return l;
    }

    ClaimLine hotel(String city, int nights, String amount) {
        ClaimLine l = line(Category.HOTEL, amount, WEDNESDAY, true);
        l.setCity(city);
        l.setNights((short) nights);
        return l;
    }

    Claim claim(Employee owner, ClaimLine... ls) {
        Claim c = new Claim();
        c.setId(100L);
        c.setClaimNumber("EXP-2026-000100");
        c.setEmployee(owner);
        List<ClaimLine> list = new ArrayList<>();
        short n = 1;
        for (ClaimLine l : ls) {
            l.setLineNo(n++);
            l.setClaim(c);
            list.add(l);
        }
        c.setLines(list);
        return c;
    }

    // ------------------------------------------------------------------ R4 receipt

    @ParameterizedTest(name = "R4: {0} INR without receipt -> {1}")
    @CsvSource({"500.00, AUTO_APPROVE", "500.01, AUTO_REJECT"})
    void receiptRequiredAbove500(String amount, LineOutcome expected) {
        Claim c = claim(employee, line(Category.MEALS, amount, WEDNESDAY, false));
        PolicyEngine.Result r = engine.evaluate(c);

        ClaimLine l = c.getLines().get(0);
        assertThat(l.getOutcome()).isEqualTo(expected);
        if (expected == LineOutcome.AUTO_REJECT) {
            assertThat(l.getFlags()).contains(PolicyEngine.FLAG_MISSING_RECEIPT);
            assertThat(l.getReason()).isEqualTo("Receipt required above 500 INR");
            assertThat(r.targetStatus()).isEqualTo(ClaimStatus.REJECTED);
        } else {
            assertThat(l.getFlags()).isEmpty();
            assertThat(r.targetStatus()).isEqualTo(ClaimStatus.APPROVED);
        }
    }

    @Test
    @DisplayName("Precedence: missing receipt + over limit -> AUTO_REJECT, both flags kept")
    void autoRejectWinsOverRoute() {
        Claim c = claim(employee, line(Category.LOCAL_CAB, "2500.00", SATURDAY, false));
        PolicyEngine.Result r = engine.evaluate(c);

        ClaimLine l = c.getLines().get(0);
        assertThat(l.getOutcome()).isEqualTo(LineOutcome.AUTO_REJECT);
        assertThat(l.getFlags()).contains(PolicyEngine.FLAG_MISSING_RECEIPT, PolicyEngine.FLAG_OVER_LIMIT,
                PolicyEngine.FLAG_WEEKEND);
        assertThat(r.targetStatus()).isEqualTo(ClaimStatus.REJECTED);
    }

    // ------------------------------------------------------------------ R1 meals

    @ParameterizedTest(name = "R1: meals {0} on one day -> {1}")
    @CsvSource({"1500.00, AUTO_APPROVE", "1500.01, ROUTE"})
    void mealsDailyLimit(String amount, LineOutcome expected) {
        Claim c = claim(employee, line(Category.MEALS, amount, WEDNESDAY, true));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getOutcome()).isEqualTo(expected);
        assertThat(c.getLines().get(0).getFlags().contains(PolicyEngine.FLAG_OVER_LIMIT))
                .isEqualTo(expected == LineOutcome.ROUTE);
    }

    @Test
    @DisplayName("R1: daily meal sum includes the employee's other claims (A6)")
    void mealsSumAcrossClaims() {
        when(lines.sumMealsForEmployeeOnDate(2L, WEDNESDAY, 100L)).thenReturn(new BigDecimal("1000.00"));
        Claim c = claim(employee, line(Category.MEALS, "500.01", WEDNESDAY, true));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getFlags()).contains(PolicyEngine.FLAG_OVER_LIMIT);
    }

    @Test
    @DisplayName("R1: two meal lines in the same claim on the same day are summed")
    void mealsSumWithinClaim() {
        Claim c = claim(employee,
                line(Category.MEALS, "800.00", WEDNESDAY, true),
                line(Category.MEALS, "800.00", WEDNESDAY, true));
        engine.evaluate(c);
        assertThat(c.getLines()).allSatisfy(l -> assertThat(l.getFlags()).contains(PolicyEngine.FLAG_OVER_LIMIT));
    }

    // ------------------------------------------------------------------ R2 hotel

    @ParameterizedTest(name = "R2: {0}, {1} nights, {2} INR -> {3}")
    @CsvSource({
            "Mumbai, 2, 12000.00, AUTO_APPROVE",   // 6,000/night tier-1
            "Mumbai, 2, 12000.02, ROUTE",          // 6,000.01/night
            "Indore, 2, 8000.00,  AUTO_APPROVE",   // 4,000/night other
            "Indore, 2, 8000.02,  ROUTE",          // 4,000.01/night
            "Indore, 1, 6000.00,  ROUTE",          // tier-1 price outside tier-1
            "Mumbai, 3, 18000.00, AUTO_APPROVE",   // exactly 3 x 6,000
            "Mumbai, 3, 18000.01, ROUTE"           // 6,000.0033/night: must not be rounded down to 6,000.00
    })
    void hotelPerNightLimit(String city, int nights, String amount, LineOutcome expected) {
        Claim c = claim(employee, hotel(city, nights, amount));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getOutcome()).isEqualTo(expected);
    }

    @Test
    @DisplayName("R2: tier-1 match ignores case and surrounding spaces")
    void hotelTier1CaseInsensitive() {
        Claim c = claim(employee, hotel(" mumbai ", 1, "5500.00"));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getOutcome()).isEqualTo(LineOutcome.AUTO_APPROVE);
    }

    // ------------------------------------------------------------------ R3 cab

    @ParameterizedTest(name = "R3: cab {0} -> {1}")
    @CsvSource({"2000.00, AUTO_APPROVE", "2000.01, ROUTE"})
    void cabPerTrip(String amount, LineOutcome expected) {
        Claim c = claim(employee, line(Category.LOCAL_CAB, amount, WEDNESDAY, true));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getOutcome()).isEqualTo(expected);
    }

    // ------------------------------------------------------------------ R5 duplicates

    @Test
    @DisplayName("R5: same vendor + amount + date as an earlier line of the same employee")
    void duplicateByFields() {
        when(lines.findDuplicatesByFields(anyLong(), anyString(), any(), any(), any())).thenReturn(List.of(new ClaimLine()));
        Claim c = claim(employee, line(Category.MEALS, "300.00", WEDNESDAY, true));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getFlags()).containsExactly(PolicyEngine.FLAG_DUPLICATE);
        assertThat(c.getLines().get(0).getOutcome()).isEqualTo(LineOutcome.ROUTE);
    }

    @Test
    @DisplayName("R5: same receipt SHA-256 as any earlier line (any employee)")
    void duplicateByReceiptHash() {
        when(lines.findDuplicatesByReceiptHash(anyString(), any())).thenReturn(List.of(new ClaimLine()));
        Claim c = claim(employee, line(Category.MEALS, "300.00", WEDNESDAY, true));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getFlags()).containsExactly(PolicyEngine.FLAG_DUPLICATE);
    }

    @Test
    @DisplayName("R5: later line in the same claim duplicates an earlier one (vendor case-insensitive, trimmed)")
    void duplicateWithinClaim() {
        ClaimLine a = line(Category.MEALS, "300.00", WEDNESDAY, true);
        ClaimLine b = line(Category.MEALS, "300.00", WEDNESDAY, true);
        a.setVendor("Cafe Coffee Day");
        b.setVendor("  cafe coffee day ");
        Claim c = claim(employee, a, b);
        engine.evaluate(c);
        assertThat(a.getFlags()).doesNotContain(PolicyEngine.FLAG_DUPLICATE);
        assertThat(b.getFlags()).contains(PolicyEngine.FLAG_DUPLICATE);
    }

    @Test
    @DisplayName("R5: the same receipt file on two lines of one claim")
    void duplicateReceiptWithinClaim() {
        ClaimLine a = line(Category.MEALS, "300.00", WEDNESDAY, true);
        ClaimLine b = line(Category.MEALS, "310.00", WEDNESDAY, false);
        b.setReceipt(a.getReceipt());
        Claim c = claim(employee, a, b);
        engine.evaluate(c);
        assertThat(a.getFlags()).doesNotContain(PolicyEngine.FLAG_DUPLICATE);
        assertThat(b.getFlags()).contains(PolicyEngine.FLAG_DUPLICATE);
    }

    @Test
    @DisplayName("R5: an earlier uploaded receipt with the same bytes (any employee, attached or not)")
    void duplicateByReceiptTable() {
        when(lines.existsOtherReceiptWithHash(anyString(), anyLong())).thenReturn(true);
        Claim c = claim(employee, line(Category.MEALS, "300.00", WEDNESDAY, true));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getFlags()).containsExactly(PolicyEngine.FLAG_DUPLICATE);
    }

    @Test
    @DisplayName("All checks run: missing receipt on a FLIGHT keeps NO_POLICY too")
    void allFlagsCollected() {
        Claim c = claim(employee, line(Category.FLIGHT, "600.00", WEDNESDAY, false));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getOutcome()).isEqualTo(LineOutcome.AUTO_REJECT);
        assertThat(c.getLines().get(0).getFlags())
                .containsExactlyInAnyOrder(PolicyEngine.FLAG_MISSING_RECEIPT, PolicyEngine.FLAG_NO_POLICY);
    }

    @Test
    @DisplayName("R11: roughly 10% of clean claims are sampled, not a fixed pattern")
    void sampleAuditRate() {
        int sampled = 0;
        for (int i = 0; i < 2000; i++) {
            Claim c = claim(employee, line(Category.MEALS, "100.00", WEDNESDAY, true));
            if (engine.evaluate(c).sampleAudit()) sampled++;
        }
        assertThat(sampled).isBetween(120, 290);   // 10% of 2,000 = 200; wide band, no flaky failures
    }

    // ------------------------------------------------------------------ R6 weekend, NO_POLICY

    @Test
    void weekendFlagsSaturdayAndSunday() {
        Claim c = claim(employee,
                line(Category.LOCAL_CAB, "300.00", SATURDAY, true),
                line(Category.LOCAL_CAB, "301.00", SUNDAY, true),
                line(Category.LOCAL_CAB, "302.00", WEDNESDAY, true));
        engine.evaluate(c);
        assertThat(c.getLines().get(0).getFlags()).containsExactly(PolicyEngine.FLAG_WEEKEND);
        assertThat(c.getLines().get(1).getFlags()).containsExactly(PolicyEngine.FLAG_WEEKEND);
        assertThat(c.getLines().get(2).getFlags()).isEmpty();
    }

    @ParameterizedTest(name = "NO_POLICY: {0}")
    @EnumSource(value = Category.class, names = {"FLIGHT", "TRAIN", "OTHER"})
    void categoriesWithoutRuleAreRouted(Category category) {
        Claim c = claim(employee, line(category, "100.00", WEDNESDAY, true));
        PolicyEngine.Result r = engine.evaluate(c);
        assertThat(c.getLines().get(0).getFlags()).containsExactly(PolicyEngine.FLAG_NO_POLICY);
        assertThat(r.targetStatus()).isEqualTo(ClaimStatus.PENDING_MANAGER);
    }

    // ------------------------------------------------------------------ claim outcome R8 / R16

    @ParameterizedTest(name = "R16: clean claim total {1} -> {2}")
    @CsvSource({"1000.00, 5000.00, APPROVED", "1000.01, 5000.01, PENDING_MANAGER"})
    void autoApproveMaxTotal(String cabAmount, String expectedTotal, ClaimStatus expected) {
        // every line within its limit, with a receipt, on a weekday: meals 1,000 + cab + hotel 3,000 (non-tier-1)
        Claim c = claim(employee,
                line(Category.MEALS, "1000.00", WEDNESDAY, true),
                line(Category.LOCAL_CAB, cabAmount, WEDNESDAY, true),
                hotel("Indore", 1, "3000.00"));
        PolicyEngine.Result r = engine.evaluate(c);
        assertThat(c.getLines()).allSatisfy(l -> assertThat(l.getOutcome()).isEqualTo(LineOutcome.AUTO_APPROVE));
        assertThat(c.getTotalAmount()).isEqualByComparingTo(expectedTotal);
        assertThat(r.targetStatus()).isEqualTo(expected);
    }

    @Test
    @DisplayName("Routed claim of an employee without a manager goes to the auditor")
    void noManagerGoesToAuditor() {
        Claim c = claim(manager, line(Category.FLIGHT, "4000.00", WEDNESDAY, true));
        assertThat(engine.evaluate(c).targetStatus()).isEqualTo(ClaimStatus.PENDING_AUDITOR);
    }

    @Test
    @DisplayName("Golden demo claim (README sec 3): hotel OVER_LIMIT, cab WEEKEND, flight NO_POLICY -> PENDING_MANAGER")
    void goldenDemoClaim() {
        ClaimLine h = hotel("Mumbai", 3, "22500.00");
        ClaimLine meals = line(Category.MEALS, "1200.00", WEDNESDAY, true);
        ClaimLine cab = line(Category.LOCAL_CAB, "800.00", SATURDAY, true);
        ClaimLine flight = line(Category.FLIGHT, "6000.00", WEDNESDAY, true);
        Claim c = claim(employee, h, meals, cab, flight);

        PolicyEngine.Result r = engine.evaluate(c);

        assertThat(h.getFlags()).containsExactly(PolicyEngine.FLAG_OVER_LIMIT);
        assertThat(meals.getOutcome()).isEqualTo(LineOutcome.AUTO_APPROVE);
        assertThat(cab.getFlags()).containsExactly(PolicyEngine.FLAG_WEEKEND);
        assertThat(flight.getFlags()).containsExactly(PolicyEngine.FLAG_NO_POLICY);
        assertThat(c.getTotalAmount()).isEqualByComparingTo("30500.00");
        assertThat(r.targetStatus()).isEqualTo(ClaimStatus.PENDING_MANAGER);
        assertThat(r.sampleAudit()).isFalse();
    }

    @Test
    @DisplayName("Policy outcome counter is published under the README 9.4 name")
    void outcomeMetric() {
        engine.evaluate(claim(employee, line(Category.MEALS, "100.00", WEDNESDAY, true)));
        assertThat(registry.get("expenseflow_policy_outcomes_total").tag("outcome", "AUTO_APPROVE").counter().count())
                .isEqualTo(1.0);
    }
}
