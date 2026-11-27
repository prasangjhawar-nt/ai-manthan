package com.expenseflow.service;

import com.expenseflow.filter.CorrelationIdFilter;
import com.expenseflow.model.AuditEvent;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Employee;
import com.expenseflow.repository.AuditEventRepository;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

@Service
public class AuditService {

    private final AuditEventRepository repo;

    public AuditService(AuditEventRepository repo) {
        this.repo = repo;
    }

    public enum Action {
        CLAIM_CREATED, CLAIM_UPDATED, CLAIM_SUBMITTED, POLICY_EVALUATED,
        CLAIM_APPROVED, CLAIM_SENT_BACK, CLAIM_REJECTED,
        SAMPLE_AUDIT_CLEARED, SAMPLE_AUDIT_FAILED,
        COMMENT_ADDED, RECEIPT_UPLOADED, DELEGATION_CREATED,
        PAYOUT_BATCH_CREATED, PAYOUT_SEND_FAILED, PAYOUT_SENT, CLAIM_PAID,
        LOGIN, SEEDED
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
        return repo.save(e);
    }
}
