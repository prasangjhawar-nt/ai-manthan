package com.expenseflow.repository;

import com.expenseflow.model.ClaimLine;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public interface ClaimLineRepository extends JpaRepository<ClaimLine, Long> {

    @Query("""
            select coalesce(sum(l.amount), 0)
            from ClaimLine l
            where l.claim.employee.id = :employeeId
              and l.category = com.expenseflow.model.Category.MEALS
              and l.expenseDate = :date
              and l.claim.status <> com.expenseflow.model.ClaimStatus.REJECTED
              and l.claim.status <> com.expenseflow.model.ClaimStatus.DRAFT
              and (:excludeClaimId is null or l.claim.id <> :excludeClaimId)
            """)
    BigDecimal sumMealsForEmployeeOnDate(@Param("employeeId") Long employeeId,
                                        @Param("date") LocalDate date,
                                        @Param("excludeClaimId") Long excludeClaimId);

    @Query("""
            select l from ClaimLine l
            where l.claim.employee.id = :employeeId
              and lower(trim(l.vendor)) = lower(trim(:vendor))
              and l.amount = :amount
              and l.expenseDate = :date
              and l.claim.status <> com.expenseflow.model.ClaimStatus.REJECTED
              and l.claim.status <> com.expenseflow.model.ClaimStatus.DRAFT
              and (:excludeClaimId is null or l.claim.id <> :excludeClaimId)
            """)
    List<ClaimLine> findDuplicatesByFields(@Param("employeeId") Long employeeId,
                                           @Param("vendor") String vendor,
                                           @Param("amount") BigDecimal amount,
                                           @Param("date") LocalDate date,
                                           @Param("excludeClaimId") Long excludeClaimId);

    @Query("""
            select l from ClaimLine l
            where l.receipt is not null
              and l.receipt.sha256 = :sha256
              and l.claim.status <> com.expenseflow.model.ClaimStatus.REJECTED
              and l.claim.status <> com.expenseflow.model.ClaimStatus.DRAFT
              and (:excludeClaimId is null or l.claim.id <> :excludeClaimId)
            """)
    List<ClaimLine> findDuplicatesByReceiptHash(@Param("sha256") String sha256,
                                                @Param("excludeClaimId") Long excludeClaimId);

    /** R5 by hash: any OTHER uploaded receipt (any employee, any claim state, attached or not) with the same bytes. */
    @Query("select count(r) > 0 from Receipt r where r.sha256 = :sha256 and r.id <> :receiptId")
    boolean existsOtherReceiptWithHash(@Param("sha256") String sha256, @Param("receiptId") Long receiptId);

    /** Claims (with claimant + manager) that use a receipt – for the receipt object-level check. */
    @Query("""
            select distinct c from ClaimLine l join l.claim c join fetch c.employee e left join fetch e.manager
            where l.receipt.id = :receiptId
            """)
    List<com.expenseflow.model.Claim> findClaimsUsingReceipt(@Param("receiptId") Long receiptId);

    @Query("""
            select l.category, l.flags, l.amount from ClaimLine l
            where l.claim.submittedAt between :from and :to
              and l.claim.status in (com.expenseflow.model.ClaimStatus.APPROVED,
                                     com.expenseflow.model.ClaimStatus.IN_PAYOUT,
                                     com.expenseflow.model.ClaimStatus.PAID)
            """)
    List<Object[]> findForDashboard(@Param("from") java.time.Instant from,
                                    @Param("to") java.time.Instant to);
}
