package com.expenseflow.service;

import com.expenseflow.model.*;
import com.expenseflow.repository.ClaimLineRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.Mockito;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Pure unit tests for PolicyEngine. The DB is mocked so we control
 * "prior lines" deterministically and can assert on every rule boundary
 * called out in README section 4.3 and §12.
 */
class PolicyEngineTest {

    PolicyConfigCache cache;
    ClaimLineRepository lines;
    PolicyEngine engine;

    @BeforeEach
    void setUp() {
        cache = Mockito.mock(PolicyConfigCache.class);
        lines = Mockito.mock(ClaimLineRepository.class);

        PolicyRule mealRule   = rule("MEAL_DAILY",  Category.MEALS,     new BigDecimal("1500.00"), null);
        PolicyRule hotelT1    = rule("HOTEL_T1",    Category.HOTEL,     new BigDecimal("6000.00"), (short) 1);
        PolicyRule hotelOther = rule("HOTEL_OTHER", Category.HOTEL,     new BigDecimal("4000.00"), (short) 2);
        PolicyRule cabRule    = rule("CAB_TRIP",    Category.LOCAL_CAB, new BigDecimal("2000.00"), null);

        var snapshot = new PolicyConfigCache.Snapshot(
                Instant.now(),
                List.of(mealRule, hotelT1, hotelOther, cabRule),
                List.of(),
                Set.of("Mumbai", "Delhi", "Bengaluru"),
                java.util.Map.of(
                        "receipt.required.above", "500",
                        "auto_approve.max_total", "5000",
                        "sample_audit.rate",     "0.10"
                )
        );
        when(cache.get()).thenReturn(snapshot);
        when(lines.sumMealsForEmployeeOnDate(any(), any(), any())).thenReturn(BigDecimal.ZERO);
        when(lines.findDuplicatesByFields(any(), any(), any(), any(), any())).thenReturn(List.of());
        when(lines.findDuplicatesByReceiptHash(any(), any())).thenReturn(List.of());

        engine = new PolicyEngine(cache, lines, new SimpleMeterRegistry());
    }

    // ---------- R4: receipt required above 500 ----------

    @ParameterizedTest(name = "R4 receipt required @ amount={0} hasReceipt={1} -> {2}")
    @CsvSource({
            "400.00, false, AUTO_APPROVE",   // under threshold, no receipt needed
            "500.00, false, AUTO_APPROVE",   // inclusive boundary
            "500.01, false, AUTO_REJECT",    // just above -> missing receipt reject
            "800.00, false, AUTO_REJECT",
            "800.00, true,  AUTO_APPROVE"    // above threshold but with receipt, meals under 1500
    })
    @DisplayName("R4 — receipt required above 500 INR (boundary)")
    void r4_receiptRequired(String amount, boolean hasReceipt, String expected) {
        Claim claim = singleLine(Category.MEALS, new BigDecimal(amount), LocalDate.now().minusDays(1),
                "Cafe", null, null, hasReceipt);
        PolicyEngine.Result r = engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getOutcome()).hasToString(expected);
        if (expected.equals("AUTO_REJECT")) {
            assertThat(claim.getLines().get(0).getFlags()).contains("MISSING_RECEIPT");
            assertThat(r.targetStatus()).isEqualTo(ClaimStatus.REJECTED);
        }
    }

    // ---------- R1: meals daily sum <= 1500 ----------

    @ParameterizedTest(name = "R1 meals daily @ {0} prior={1} -> {2}")
    @CsvSource({
            "1500.00, 0.00,    AUTO_APPROVE",   // exactly at limit, clean
            "1500.01, 0.00,    ROUTE",          // just over
            "400.00,  1100.00, AUTO_APPROVE",   // sum=1500, boundary
            "400.01,  1100.00, ROUTE"           // sum=1500.01
    })
    @DisplayName("R1 — meals ≤ 1500 per employee per day (boundary + accumulator)")
    void r1_mealsDaily(String amount, String priorSum, String expected) {
        when(lines.sumMealsForEmployeeOnDate(any(), any(), any())).thenReturn(new BigDecimal(priorSum));
        // Attach a receipt so R4 doesn't fire
        Claim claim = singleLine(Category.MEALS, new BigDecimal(amount), LocalDate.now().minusDays(1),
                "Cafe", null, null, true);
        engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getOutcome()).hasToString(expected);
        if (expected.equals("ROUTE")) {
            assertThat(claim.getLines().get(0).getFlags()).contains("OVER_LIMIT");
        }
    }

    // ---------- R2: hotel tier-1 <= 6000/night, other <= 4000/night ----------

    @ParameterizedTest(name = "R2 hotel {3} {0} / {1}n -> per-night check -> {2}")
    @CsvSource({
            "18000.00, 3, AUTO_APPROVE, Mumbai",    // 6000/night tier-1 inclusive
            "18000.03, 3, ROUTE,        Mumbai",    // 6000.01/night just over
            "12000.00, 3, AUTO_APPROVE, Pune",      // 4000/night non-tier-1 inclusive (Pune not in test tier-1 set)
            "12000.03, 3, ROUTE,        Pune"       // just over
    })
    @DisplayName("R2 — hotel per-night limit (tier-1 vs other, boundary)")
    void r2_hotelPerNight(String amount, int nights, String expected, String city) {
        Claim claim = singleLine(Category.HOTEL, new BigDecimal(amount), LocalDate.now().minusDays(1),
                "Hotel X", city, (short) nights, true);
        engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getOutcome()).hasToString(expected);
    }

    // ---------- R3: cab <= 2000 per trip ----------

    @ParameterizedTest(name = "R3 cab @ {0} -> {1}")
    @CsvSource({
            "2000.00, AUTO_APPROVE",     // inclusive boundary
            "2000.01, ROUTE",            // just over
            "500.00,  AUTO_APPROVE"      // low, no receipt needed
    })
    @DisplayName("R3 — local cab ≤ 2000 per trip (boundary)")
    void r3_cab(String amount, String expected) {
        boolean withReceipt = new BigDecimal(amount).compareTo(new BigDecimal("500")) > 0;
        Claim claim = singleLine(Category.LOCAL_CAB, new BigDecimal(amount), LocalDate.now().minusDays(2),
                "Ola", "Mumbai", null, withReceipt);
        engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getOutcome()).hasToString(expected);
    }

    // ---------- R5: duplicate by fields and by receipt hash ----------

    @Test
    @DisplayName("R5 — duplicate by vendor+amount+date flags DUPLICATE and routes")
    void r5_fieldDuplicate() {
        ClaimLine existing = mock();
        when(lines.findDuplicatesByFields(any(), any(), any(), any(), any())).thenReturn(List.of(existing));
        Claim claim = singleLine(Category.MEALS, new BigDecimal("400"), LocalDate.now().minusDays(1),
                "Cafe", null, null, false);
        engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getOutcome()).hasToString("ROUTE");
        assertThat(claim.getLines().get(0).getFlags()).contains("DUPLICATE");
    }

    @Test
    @DisplayName("R5 — duplicate by receipt SHA flags DUPLICATE and routes")
    void r5_hashDuplicate() {
        ClaimLine existing = mock();
        when(lines.findDuplicatesByReceiptHash(any(), any())).thenReturn(List.of(existing));
        Claim claim = singleLine(Category.MEALS, new BigDecimal("450"), LocalDate.now().minusDays(1),
                "Cafe", null, null, true);
        engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getOutcome()).hasToString("ROUTE");
        assertThat(claim.getLines().get(0).getFlags()).contains("DUPLICATE");
    }

    // ---------- R6: weekend ----------

    @Test
    @DisplayName("R6 — Saturday flags WEEKEND and routes")
    void r6_saturday() {
        LocalDate sat = findSaturday();
        Claim claim = singleLine(Category.MEALS, new BigDecimal("400"), sat, "Cafe", null, null, false);
        engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getFlags()).contains("WEEKEND");
        assertThat(claim.getLines().get(0).getOutcome()).hasToString("ROUTE");
    }

    @Test
    @DisplayName("R6 — Sunday flags WEEKEND and routes")
    void r6_sunday() {
        LocalDate sun = findSaturday().plusDays(1);
        Claim claim = singleLine(Category.MEALS, new BigDecimal("400"), sun, "Cafe", null, null, false);
        engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getFlags()).contains("WEEKEND");
    }

    // ---------- NO_POLICY ----------

    @Test
    @DisplayName("Category without a rule flags NO_POLICY and routes")
    void noPolicyCategory() {
        Claim claim = singleLine(Category.FLIGHT, new BigDecimal("6000"), LocalDate.now().minusDays(1),
                "IndiGo", null, null, true);
        engine.evaluate(claim);
        assertThat(claim.getLines().get(0).getFlags()).contains("NO_POLICY");
        assertThat(claim.getLines().get(0).getOutcome()).hasToString("ROUTE");
    }

    // ---------- Claim-level outcome aggregation ----------

    @ParameterizedTest(name = "auto-approve max_total boundary: total={0} per-day=1500 -> {1}")
    @CsvSource({
            "1500.00, APPROVED",          // 1 day @ 1500 = 1500, well under 5000
            "4500.00, APPROVED",          // 3 days @ 1500 each, total 4500
            "5100.00, PENDING_MANAGER"    // exceeds auto-approve total but each line still clean
    })
    @DisplayName("R16 — claim auto-approves only when all clean AND total ≤ 5000")
    void autoApproveTotalBoundary(String firstDayAmount, String expected) {
        // Build multi-line claim where each line is individually clean (MEALS<=1500/day),
        // but total crosses the auto_approve.max_total threshold of 5000.
        Claim c = baseClaim();
        BigDecimal perDay = new BigDecimal(firstDayAmount).min(new BigDecimal("1500"));
        BigDecimal remaining = new BigDecimal(firstDayAmount);
        short no = 1;
        int dayOffset = 1;
        while (remaining.compareTo(BigDecimal.ZERO) > 0) {
            BigDecimal amt = remaining.min(perDay);
            // Avoid weekend
            LocalDate d = LocalDate.now().minusDays(dayOffset);
            while (d.getDayOfWeek().getValue() >= 6) d = d.minusDays(1);
            boolean withReceipt = amt.compareTo(new BigDecimal("500")) > 0;
            c.getLines().add(line(c, no++, Category.MEALS, amt, d, "Cafe", null, null, withReceipt));
            remaining = remaining.subtract(amt);
            dayOffset++;
        }
        var r = engine.evaluate(c);
        assertThat(r.targetStatus().name()).isEqualTo(expected);
    }

    @Test
    @DisplayName("Any AUTO_REJECT line forces REJECTED even if others would route")
    void autoRejectPrecedence() {
        Claim c = baseClaim();
        c.getLines().add(line(c, (short)1, Category.MEALS, new BigDecimal("800"),
                LocalDate.now().minusDays(1), "A", null, null, false)); // no receipt, >500 -> AUTO_REJECT
        c.getLines().add(line(c, (short)2, Category.HOTEL, new BigDecimal("30000"),
                LocalDate.now().minusDays(1), "H", "Mumbai", (short)3, true)); // tier1 over-limit -> ROUTE
        var r = engine.evaluate(c);
        assertThat(r.targetStatus()).isEqualTo(ClaimStatus.REJECTED);
    }

    @Test
    @DisplayName("Claimant with no manager is routed to PENDING_AUDITOR")
    void noManagerGoesToAuditor() {
        Claim c = singleLine(Category.FLIGHT, new BigDecimal("6000"), LocalDate.now().minusDays(1),
                "IndiGo", null, null, true);
        c.getEmployee().setManager(null);  // no manager
        var r = engine.evaluate(c);
        assertThat(r.targetStatus()).isEqualTo(ClaimStatus.PENDING_AUDITOR);
    }

    // ---------- helpers ----------

    private Claim singleLine(Category cat, BigDecimal amt, LocalDate date, String vendor,
                             String city, Short nights, boolean withReceipt) {
        Claim c = baseClaim();
        c.getLines().add(line(c, (short) 1, cat, amt, date, vendor, city, nights, withReceipt));
        return c;
    }

    private Claim baseClaim() {
        Employee emp = new Employee();
        emp.setId(100L);
        emp.setName("Test Emp");
        Employee mgr = someManager();
        emp.setManager(mgr);
        Claim c = new Claim();
        c.setId(1L);
        c.setClaimNumber("EXP-2026-000001");
        c.setEmployee(emp);
        c.setStatus(ClaimStatus.DRAFT);
        return c;
    }

    private Employee someManager() {
        Employee m = new Employee();
        m.setId(200L);
        m.setName("The Manager");
        return m;
    }

    private ClaimLine line(Claim claim, short no, Category cat, BigDecimal amt, LocalDate date,
                           String vendor, String city, Short nights, boolean withReceipt) {
        ClaimLine l = new ClaimLine();
        l.setClaim(claim);
        l.setLineNo(no);
        l.setCategory(cat);
        l.setAmount(amt);
        l.setExpenseDate(date);
        l.setVendor(vendor);
        l.setCity(city);
        l.setNights(nights);
        if (withReceipt) {
            Receipt r = new Receipt();
            r.setId(500L + no);
            r.setSha256(String.format("%064x", 500L + no)); // distinct receipt per line (same hash = R5 duplicate)
            l.setReceipt(r);
        }
        return l;
    }

    private ClaimLine mock() { return new ClaimLine(); }

    private PolicyRule rule(String code, Category c, BigDecimal limit, Short tier) {
        PolicyRule r = new PolicyRule();
        r.setCode(code); r.setCategory(c); r.setLimitAmount(limit); r.setCityTier(tier);
        r.setUnit("X"); r.setActive(true);
        return r;
    }

    private LocalDate findSaturday() {
        LocalDate d = LocalDate.now();
        while (d.getDayOfWeek().getValue() != 6) d = d.minusDays(1);
        return d;
    }
}
