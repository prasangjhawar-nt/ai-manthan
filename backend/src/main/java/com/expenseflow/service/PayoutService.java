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

    public PayoutService(PayoutBatchRepository batches, ClaimRepository claims,
                         CurrentUser current, AuditService audit, IdempotencyService idem,
                         ClaimNumberGenerator numbers, BankClient bank, MeterRegistry registry) {
        this.batches = batches;
        this.claims = claims;
        this.current = current;
        this.audit = audit;
        this.idem = idem;
        this.numbers = numbers;
        this.bank = bank;
        registry.gauge("expenseflow_payout_pending_batches", this,
                p -> p.batches.findByStatusOrderByCreatedAtAsc(PayoutBatchStatus.PENDING_SEND).size());
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

    @Transactional
    public PayoutBatchDto create(List<Long> claimIds, String idemKey) {
        assertHead();
        Employee me = current.employee();
        String bodyHash = idem.hashBody(claimIds);
        Optional<IdempotencyKey> existing = idem.findExisting(idemKey, me.getId());
        if (existing.isPresent()) {
            idem.assertSameBody(existing.get(), bodyHash);
            idem.markReplay();
            return idem.decode(existing.get(), PayoutBatchDto.class);
        }

        List<Claim> selected = new ArrayList<>();
        for (Long id : claimIds) {
            Claim c = claims.findByIdWithEmployee(id)
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
        String csv = PayoutCsv.build(batchRef, selected);
        String fileName = "PAYOUT_" + batchRef + "_" + java.time.LocalDate.now().toString().replace("-", "") + ".csv";

        PayoutBatch batch = new PayoutBatch();
        batch.setBatchRef(batchRef);
        batch.setStatus(PayoutBatchStatus.PENDING_SEND);
        batch.setClaimCount(selected.size());
        batch.setTotalAmount(total);
        batch.setFileName(fileName);
        batch.setCsvContent(csv);
        batch.setAttempts(0);
        batch.setCreatedBy(me);
        PayoutBatch savedBatch = batches.save(batch);

        for (Claim c : selected) {
            c.setStatus(ClaimStatus.IN_PAYOUT);
            c.setPayoutBatch(savedBatch);
            claims.save(c);
        }

        audit.record(AuditService.Action.PAYOUT_BATCH_CREATED, AuditService.EntityType.PAYOUT_BATCH,
                savedBatch.getId(), null, me, null, null, null,
                Map.of("batchRef", batchRef, "claims", selected.size(), "total", total));

        trySend(savedBatch, selected);

        PayoutBatchDto dto = PayoutBatchDto.from(savedBatch, selected);
        idem.store(idemKey, me.getId(), "POST /api/payout-batches", bodyHash, 201, dto);
        return dto;
    }

    @Transactional
    public PayoutBatchDto retry(Long id) {
        assertHead();
        PayoutBatch b = batches.findById(id).orElseThrow(() -> ApiException.notFound("Batch not found"));
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
            audit.record(AuditService.Action.PAYOUT_SENT, AuditService.EntityType.PAYOUT_BATCH,
                    batch.getId(), null, batch.getCreatedBy(), null, null, null,
                    Map.of("batchRef", batch.getBatchRef(), "bankReference", ref.get()));
        } else {
            batch.setLastError("Bank did not accept the batch (attempt " + batch.getAttempts() + ")");
            batches.save(batch);
            audit.record(AuditService.Action.PAYOUT_SEND_FAILED, AuditService.EntityType.PAYOUT_BATCH,
                    batch.getId(), null, batch.getCreatedBy(), null, null, null,
                    Map.of("batchRef", batch.getBatchRef(), "attempt", batch.getAttempts()));
        }
    }
}
