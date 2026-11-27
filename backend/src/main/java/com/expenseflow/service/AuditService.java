package com.expenseflow.service;

import com.expenseflow.filter.CorrelationIdFilter;
import com.expenseflow.model.AuditEvent;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Employee;
import com.expenseflow.repository.AuditEventRepository;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.Map;

@Service
public class AuditService {

    private final AuditEventRepository repo;
    private final MeterRegistry registry;

    public AuditService(AuditEventRepository repo, MeterRegistry registry) {
        this.repo = repo;
        this.registry = registry;
    }

    public enum Action {
        CLAIM_CREATED, CLAIM_UPDATED, CLAIM_SUBMITTED, POLICY_EVALUATED,
        CLAIM_APPROVED, CLAIM_SENT_BACK, CLAIM_REJECTED,
        SAMPLE_AUDIT_CLEARED, SAMPLE_AUDIT_FAILED,
        COMMENT_ADDED, RECEIPT_UPLOADED, DELEGATION_CREATED,
        PAYOUT_BATCH_CREATED, CLAIM_IN_PAYOUT, PAYOUT_SEND_FAILED, PAYOUT_SENT, CLAIM_PAID,
        LOGIN, SEEDED,
        USER_CREATED
    }

    public enum EntityType { CLAIM, RECEIPT, DELEGATION, PAYOUT_BATCH, USER }

    @Transactional
    public AuditEvent record(Action action, EntityType entityType, Long entityId, Long claimId,
                             Employee actor, Employee onBehalfOf,
                             ClaimStatus from, ClaimStatus to,
                             Map<String, Object> details) {
        AuditEvent e = new AuditEvent();
        e.setAction(action.name());
        e.setEntityType(entityType.name());
        e.setEntityId(entityId);
        e.setClaimId(claimId);
        e.setActor(actor);
        e.setOnBehalfOf(onBehalfOf);
        e.setFromStatus(from == null ? null : from.name());
        e.setToStatus(to == null ? null : to.name());
        e.setDetails(details == null ? Map.of() : details);
        e.setCorrelationId(MDC.get(CorrelationIdFilter.MDC_KEY));
        AuditEvent saved = repo.save(e);
        if (from != null && to != null && from != to) {
            countTransitionAfterCommit(from, to);
        }
        return saved;
    }

    /** README 9.4 expenseflow_claim_transitions_total{from,to}; counted only if the transaction commits. */
    private void countTransitionAfterCommit(ClaimStatus from, ClaimStatus to) {
        Runnable inc = () -> Counter.builder("expenseflow_claim_transitions_total")
                .tag("from", from.name()).tag("to", to.name())
                .register(registry).increment();
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    inc.run();
                }
            });
        } else {
            inc.run();
        }
    }
}
