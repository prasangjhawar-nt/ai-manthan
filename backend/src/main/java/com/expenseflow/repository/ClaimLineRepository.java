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
              and (:excludeClaimId is null or l.claim.id <> :excludeClaimId)
            """)
    List<ClaimLine> findDuplicatesByReceiptHash(@Param("sha256") String sha256,
                                                @Param("excludeClaimId") Long excludeClaimId);

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
