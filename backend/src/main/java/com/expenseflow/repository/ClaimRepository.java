package com.expenseflow.repository;

import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ClaimRepository extends JpaRepository<Claim, Long>, org.springframework.data.jpa.repository.JpaSpecificationExecutor<Claim> {

    @Query("""
            select c from Claim c
            join fetch c.employee e
            join fetch e.department
            where c.id = :id
            """)
    Optional<Claim> findByIdWithEmployee(@Param("id") Long id);

    Page<Claim> findByEmployeeId(Long employeeId, Pageable pageable);

    /** Row lock for payout selection: a claim can be put into only one batch (R12). */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from Claim c where c.id = :id")
    Optional<Claim> findByIdForUpdate(@Param("id") Long id);

    Page<Claim> findByEmployeeIdAndStatus(Long employeeId, ClaimStatus status, Pageable pageable);

    @Query("""
            select c from Claim c
            join fetch c.employee e
            join fetch e.department
            where c.status = :status
            """)
    List<Claim> findByStatusWithEmployee(@Param("status") ClaimStatus status);
}
