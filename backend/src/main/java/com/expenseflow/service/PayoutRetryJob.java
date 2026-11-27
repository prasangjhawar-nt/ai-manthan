package com.expenseflow.service;

import com.expenseflow.model.Claim;
import com.expenseflow.model.PayoutBatch;
import com.expenseflow.model.PayoutBatchStatus;
import com.expenseflow.repository.ClaimRepository;
import com.expenseflow.repository.PayoutBatchRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Component
public class PayoutRetryJob {

    private static final Logger log = LoggerFactory.getLogger(PayoutRetryJob.class);

    private final PayoutBatchRepository batches;
    private final ClaimRepository claims;
    private final PayoutService payouts;

    public PayoutRetryJob(PayoutBatchRepository batches, ClaimRepository claims, PayoutService payouts) {
        this.batches = batches;
        this.claims = claims;
        this.payouts = payouts;
    }

    @Scheduled(fixedDelayString = "${expenseflow.payout.retry-interval-ms:30000}")
    @Transactional
    public void retry() {
        List<PayoutBatch> pending = batches.findByStatusOrderByCreatedAtAsc(PayoutBatchStatus.PENDING_SEND);
        if (pending.isEmpty()) return;
        log.info("Payout retry: {} pending batch(es)", pending.size());
        for (PayoutBatch b : pending) {
            List<Claim> inBatch = claims.findAll((r, q, cb) -> cb.equal(r.get("payoutBatch").get("id"), b.getId()));
            payouts.trySend(b, inBatch);
        }
    }
}
