package com.expenseflow.repository;

import com.expenseflow.model.AuditEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface AuditEventRepository extends JpaRepository<AuditEvent, Long> {

    @Query("""
            select a from AuditEvent a
            left join fetch a.actor
            left join fetch a.onBehalfOf
            where a.claimId = :claimId
            order by a.createdAt asc, a.id asc
            """)
    List<AuditEvent> findByClaimIdOrderByCreatedAt(@Param("claimId") Long claimId);
}
