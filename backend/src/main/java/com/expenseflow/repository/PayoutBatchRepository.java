package com.expenseflow.repository;

import com.expenseflow.model.PayoutBatch;
import com.expenseflow.model.PayoutBatchStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PayoutBatchRepository extends JpaRepository<PayoutBatch, Long> {

    List<PayoutBatch> findByStatusOrderByCreatedAtAsc(PayoutBatchStatus status);

    Page<PayoutBatch> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<PayoutBatch> findByStatusOrderByCreatedAtDesc(PayoutBatchStatus status, Pageable pageable);
}
