package com.expenseflow.repository;

import com.expenseflow.model.Delegation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface DelegationRepository extends JpaRepository<Delegation, Long> {

    @Query("""
            select d from Delegation d
            join fetch d.approver
            join fetch d.delegate
            where d.approver.id = :userId or d.delegate.id = :userId
            order by d.fromDate desc
            """)
    List<Delegation> findByUser(@Param("userId") Long userId);

    @Query("""
            select d.approver.id from Delegation d
            where d.delegate.id = :delegateId
              and d.fromDate <= :today
              and d.toDate >= :today
            """)
    List<Long> findApproverIdsForActiveDelegate(@Param("delegateId") Long delegateId,
                                                @Param("today") LocalDate today);

    @Query("""
            select count(d) > 0 from Delegation d
            where d.approver.id = :approverId
              and d.delegate.id = :delegateId
              and d.fromDate <= :today
              and d.toDate >= :today
            """)
    boolean isActiveDelegate(@Param("approverId") Long approverId,
                             @Param("delegateId") Long delegateId,
                             @Param("today") LocalDate today);
}
