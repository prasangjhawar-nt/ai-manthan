package com.expenseflow.service;

import com.expenseflow.dto.ClaimSummaryDto;
import com.expenseflow.dto.PageDto;
import com.expenseflow.dto.PayoutBatchDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Employee;
import com.expenseflow.model.IdempotencyKey;
import com.expenseflow.model.PayoutBatch;
import com.expenseflow.model.PayoutBatchStatus;
import com.expenseflow.model.Role;
import com.expenseflow.model.SampleAuditStatus;
import com.expenseflow.repository.ClaimRepository;
import com.expenseflow.repository.PayoutBatchRepository;
import com.expenseflow.security.CurrentUser;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class PayoutService {

    private final PayoutBatchRepository batches;
    private final ClaimRepository claims;
    private final CurrentUser current;
    private final AuditService audit;
    private final IdempotencyService idem;
    private final ClaimNumberGenerator numbers;
    private final BankClient bank;
    private final java.time.Duration retryInterval;
    private final org.springframework.transaction.support.TransactionTemplate tx;

    public PayoutService(PayoutBatchRepository batches, ClaimRepository claims,
                         CurrentUser current, AuditService audit, IdempotencyService idem,
                         ClaimNumberGenerator numbers, BankClient bank, MeterRegistry registry,
                         @org.springframework.beans.factory.annotation.Value("${expenseflow.payout.retry-interval-ms:30000}")
                         long retryIntervalMs,
                         org.springframework.transaction.PlatformTransactionManager txManager) {
        this.batches = batches;
        this.claims = claims;
        this.current = current;
        this.audit = audit;
        this.idem = idem;
        this.numbers = numbers;
        this.bank = bank;
        this.retryInterval = java.time.Duration.ofMillis(retryIntervalMs);
        this.tx = new org.springframework.transaction.support.TransactionTemplate(txManager);
        // COUNT only: this runs on every scrape (5 s) on every replica
        registry.gauge("expenseflow_payout_pending_batches", this,
                p -> p.batches.countByStatus(PayoutBatchStatus.PENDING_SEND));
    }

    private void assertHead() {
        if (current.role() != Role.HEAD) throw ApiException.forbidden("HEAD only");
    }

    @Transactional(readOnly = true)
    public PageDto<ClaimSummaryDto> eligible(int page, int size) {
        assertHead();
        Specification<Claim> spec = (r, q, cb) -> cb.and(
                cb.equal(r.get("status"), ClaimStatus.APPROVED),
                cb.notEqual(r.get("sampleAudit"), SampleAuditStatus.OPEN)
        );
        Page<Claim> result = claims.findAll(spec,
                PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "finalDecisionAt")));
        return PageDto.of(result, c -> ClaimSummaryDto.from(c, null));
    }

    @Transactional(readOnly = true)
    public PageDto<PayoutBatchDto> list(PayoutBatchStatus status, int page, int size) {
        assertHead();
        Page<PayoutBatch> result = status == null
                ? batches.findAllByOrderByCreatedAtDesc(PageRequest.of(page, size))
                : batches.findByStatusOrderByCreatedAtDesc(status, PageRequest.of(page, size));
        return PageDto.of(result, b -> PayoutBatchDto.from(b, null));
    }

    @Transactional(readOnly = true)
    public PayoutBatchDto get(Long id) {
        assertHead();
        PayoutBatch b = batches.findById(id).orElseThrow(() -> ApiException.notFound("Batch not found"));
        List<Claim> inBatch = claims.findAll((r, q, cb) ->
                cb.equal(r.get("payoutBatch").get("id"), id));
        return PayoutBatchDto.from(b, inBatch);
    }

    public PayoutBatch loadForFile(Long id) {
        assertHead();
        return batches.findById(id).orElseThrow(() -> ApiException.notFound("Batch not found"));
    }

    /**
     * R12 / FR-PAY-2..4. Two transactions, never a bank call inside the selection transaction:
     *  1. lock the claims (FOR UPDATE, id order), batch PENDING_SEND, claims IN_PAYOUT, idempotency key -> COMMIT
     *  2. send under the batch row lock (same path as the retry job and "Retry now") -> SENT/PAID or stays PENDING_SEND
     * A concurrent second request for the same claims waits on the row locks and then gets 409; a duplicate with the
     * same Idempotency-Key waits on the key lock and gets the same response.
     */
    public PayoutBatchDto create(List<Long> claimIds, String idemKey) {
        assertHead();
        Employee me = current.employee();
        List<Long> ids = validateIds(claimIds);
        String bodyHash = idem.hashBody(ids);
        String endpoint = "POST /api/payout-batches";

        Object first = tx.execute(status -> {
            idem.acquire(idemKey, me.getId());
            Optional<IdempotencyKey> existing = idem.findExisting(idemKey, me.getId());
            if (existing.isPresent()) {
                idem.assertSameBody(existing.get(), bodyHash);
                idem.markReplay();
                return idem.decode(existing.get(), PayoutBatchDto.class);
            }

            List<Claim> selected = new ArrayList<>();
            for (Long id : ids.stream().sorted().toList()) {          // fixed lock order: no deadlocks
                Claim c = claims.findByIdForUpdate(id)
                        .orElseThrow(() -> ApiException.badRequest("Claim " + id + " not found"));
                if (c.getStatus() != ClaimStatus.APPROVED) {
                    throw ApiException.conflict("Claim " + c.getClaimNumber() + " is " + c.getStatus() + ", not APPROVED");
                }
                if (c.getSampleAudit() == SampleAuditStatus.OPEN) {
                    throw ApiException.conflict("Claim " + c.getClaimNumber() + " has an open sample audit");
                }
                selected.add(c);
            }
            BigDecimal total = selected.stream().map(Claim::getTotalAmount).reduce(BigDecimal.ZERO, BigDecimal::add);

            String batchRef = numbers.nextBatchRef();
            String fileName = "PAYOUT_" + batchRef + "_"
                    + java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString().replace("-", "") + ".csv";

            PayoutBatch batch = new PayoutBatch();
            batch.setBatchRef(batchRef);
            batch.setStatus(PayoutBatchStatus.PENDING_SEND);
            batch.setClaimCount(selected.size());
            batch.setTotalAmount(total);
            batch.setFileName(fileName);
            batch.setCsvContent(PayoutCsv.build(batchRef, selected));
            batch.setAttempts(0);
            batch.setCreatedBy(me);
            PayoutBatch savedBatch = batches.save(batch);

            for (Claim c : selected) {
                StatusFlow.assertTransition(ClaimStatus.APPROVED, ClaimStatus.IN_PAYOUT);
                c.setStatus(ClaimStatus.IN_PAYOUT);
                c.setPayoutBatch(savedBatch);
                claims.save(c);
                audit.record(AuditService.Action.CLAIM_IN_PAYOUT, AuditService.EntityType.CLAIM,
                        c.getId(), c.getId(), me, null, ClaimStatus.APPROVED, ClaimStatus.IN_PAYOUT,
                        Map.of("batchRef", batchRef));
            }
            audit.record(AuditService.Action.PAYOUT_BATCH_CREATED, AuditService.EntityType.PAYOUT_BATCH,
                    savedBatch.getId(), null, me, null, null, null,
                    Map.of("batchRef", batchRef, "claims", selected.size(), "total", total));

            idem.store(idemKey, me.getId(), endpoint, bodyHash, 201, PayoutBatchDto.from(savedBatch, selected));
            return savedBatch.getId();
        });
        if (first instanceof PayoutBatchDto replay) {
            return replay;
        }

        Long batchId = (Long) first;
        PayoutBatchDto dto = tx.execute(status -> sendLocked(batchId));
        idem.updateResponse(idemKey, me.getId(), dto);     // a replay returns the final state, like this response
        return dto;
    }

    private static List<Long> validateIds(List<Long> claimIds) {
        if (claimIds == null || claimIds.isEmpty()) throw ApiException.badRequest("claimIds is required");
        if (claimIds.stream().anyMatch(java.util.Objects::isNull)) throw ApiException.badRequest("claimIds must not contain null");
        if (new java.util.HashSet<>(claimIds).size() != claimIds.size()) {
            throw ApiException.badRequest("claimIds must be unique");   // [42,42] would pay claim 42 twice
        }
        return List.copyOf(claimIds);
    }

    /** Send one batch under its row lock; no-op if another replica/job already sent it. */
    private PayoutBatchDto sendLocked(Long batchId) {
        PayoutBatch b = batches.findByIdForUpdate(batchId)
                .orElseThrow(() -> ApiException.notFound("Batch not found"));
        List<Claim> inBatch = claims.findAll((r, q, cb) -> cb.equal(r.get("payoutBatch").get("id"), b.getId()));
        if (b.getStatus() != PayoutBatchStatus.SENT) {
            trySend(b, inBatch);
        }
        return PayoutBatchDto.from(b, inBatch);
    }

    @Transactional
    public PayoutBatchDto retry(Long id) {
        assertHead();
        // row lock: never races the retry job (or another replica) into a double send
        PayoutBatch b = batches.findByIdForUpdate(id).orElseThrow(() -> ApiException.notFound("Batch not found"));
        if (b.getStatus() == PayoutBatchStatus.SENT) {
            throw ApiException.conflict("Batch is already SENT");
        }
        List<Claim> inBatch = claims.findAll((r, q, cb) -> cb.equal(r.get("payoutBatch").get("id"), b.getId()));
        trySend(b, inBatch);
        return PayoutBatchDto.from(b, inBatch);
    }

    /** Called from the retry scheduler too. Mutates the batch and claims in place. */
    @Transactional
    public void trySend(PayoutBatch batch, List<Claim> inBatch) {
        batch.setAttempts(batch.getAttempts() + 1);
        Optional<String> ref = bank.send(batch.getBatchRef(), batch.getCsvContent());
        if (ref.isPresent()) {
            batch.setStatus(PayoutBatchStatus.SENT);
            batch.setBankReference(ref.get());
            batch.setSentAt(Instant.now());
            batch.setLastError(null);
            batch.setNextAttemptAt(null);
            batches.save(batch);
            Instant now = Instant.now();
            for (Claim c : inBatch) {
                c.setStatus(ClaimStatus.PAID);
                c.setPaidAt(now);
                claims.save(c);
                audit.record(AuditService.Action.CLAIM_PAID, AuditService.EntityType.CLAIM,
                        c.getId(), c.getId(), null, null, ClaimStatus.IN_PAYOUT, ClaimStatus.PAID,
                        Map.of("batchRef", batch.getBatchRef(), "bankReference", ref.get()));
            }
            for (Claim c : inBatch) {   // per claim, so the claim timeline shows the payout (R14, drill 1 step 5)
                audit.record(AuditService.Action.PAYOUT_SENT, AuditService.EntityType.PAYOUT_BATCH,
                        batch.getId(), c.getId(), null, null, null, null,
                        Map.of("batchRef", batch.getBatchRef(), "bankReference", ref.get(), "attempt", batch.getAttempts()));
            }
        } else {
            batch.setLastError("Bank did not accept the batch (attempt " + batch.getAttempts() + ")");
            // half the job interval: keeps replicas from hammering the bank, but the next scheduled run
            // after a failed "create batch" still picks it up (worst case ~1.5 intervals, not 2)
            batch.setNextAttemptAt(Instant.now().plus(retryInterval.dividedBy(2)));
            batches.save(batch);
            for (Claim c : inBatch) {
                audit.record(AuditService.Action.PAYOUT_SEND_FAILED, AuditService.EntityType.PAYOUT_BATCH,
                        batch.getId(), c.getId(), null, null, null, null,
                        Map.of("batchRef", batch.getBatchRef(), "attempt", batch.getAttempts()));
            }
        }
    }
}
