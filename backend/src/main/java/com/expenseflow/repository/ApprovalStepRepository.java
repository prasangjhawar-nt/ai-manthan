package com.expenseflow.repository;

import com.expenseflow.model.ApprovalStep;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ApprovalStepRepository extends JpaRepository<ApprovalStep, Long> {

    @Query("""
            select s from ApprovalStep s
            join fetch s.approver
            join fetch s.actedBy
            where s.claim.id = :claimId
            order by s.decidedAt asc
            """)
    List<ApprovalStep> findByClaimIdOrderByDecidedAt(@Param("claimId") Long claimId);

    @Query("""
            select s from ApprovalStep s
            where s.claim.id = :claimId and s.decision = com.expenseflow.model.ApprovalDecision.APPROVED
            order by s.decidedAt desc
            """)
    List<ApprovalStep> findLastApprovalsByClaim(@Param("claimId") Long claimId);

    default Optional<ApprovalStep> findMostRecentApproval(Long claimId) {
        List<ApprovalStep> rows = findLastApprovalsByClaim(claimId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }
}
