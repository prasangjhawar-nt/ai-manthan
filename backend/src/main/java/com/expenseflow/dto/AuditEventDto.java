package com.expenseflow.dto;

import com.expenseflow.model.AuditEvent;

import java.time.Instant;
import java.util.Map;

public record AuditEventDto(
        Long id,
        Long actorId,
        String actorName,
        Long onBehalfOfId,
        String onBehalfOfName,
        String action,
        String entityType,
        Long entityId,
        Long claimId,
        String fromStatus,
        String toStatus,
        Map<String, Object> details,
        String correlationId,
        Instant createdAt
) {
    public static AuditEventDto from(AuditEvent e) {
        return new AuditEventDto(
                e.getId(),
                e.getActor() == null ? null : e.getActor().getId(),
                e.getActor() == null ? null : e.getActor().getName(),
                e.getOnBehalfOf() == null ? null : e.getOnBehalfOf().getId(),
                e.getOnBehalfOf() == null ? null : e.getOnBehalfOf().getName(),
                e.getAction(),
                e.getEntityType(),
                e.getEntityId(),
                e.getClaimId(),
                e.getFromStatus(),
                e.getToStatus(),
                e.getDetails(),
                e.getCorrelationId(),
                e.getCreatedAt()
        );
    }
}
