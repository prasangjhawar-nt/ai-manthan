package com.expenseflow.repository;

import com.expenseflow.model.PayoutBatch;
import com.expenseflow.model.PayoutBatchStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface PayoutBatchRepository extends JpaRepository<PayoutBatch, Long> {

    List<PayoutBatch> findByStatusOrderByCreatedAtAsc(PayoutBatchStatus status);

    long countByStatus(PayoutBatchStatus status);

    Page<PayoutBatch> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<PayoutBatch> findByStatusOrderByCreatedAtDesc(PayoutBatchStatus status, Pageable pageable);

    /**
     * Claims due batches for this replica only (devops.md 6.4): rows locked by another replica's
     * running transaction are skipped, so a batch is never sent twice. Call inside a transaction.
     */
    @Query(value = """
            SELECT * FROM payout_batches
            WHERE status = 'PENDING_SEND' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
            ORDER BY created_at
            LIMIT :limit
            FOR UPDATE SKIP LOCKED
            """, nativeQuery = true)
    List<PayoutBatch> lockDueForSend(@Param("limit") int limit);

    /** Manual "Retry now": waits for a running send on another replica, then re-checks the status. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from PayoutBatch b where b.id = :id")
    Optional<PayoutBatch> findByIdForUpdate(@Param("id") Long id);
}
