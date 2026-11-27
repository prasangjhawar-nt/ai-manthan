package com.expenseflow.service;

import com.expenseflow.model.ClaimStatus;
import com.expenseflow.repository.ClaimRepository;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Component
public class BusinessMetrics {

    private final ClaimRepository claims;

    public BusinessMetrics(ClaimRepository claims, MeterRegistry registry) {
        this.claims = claims;
        Map<String, ClaimStatus> levels = Map.of(
                "MANAGER", ClaimStatus.PENDING_MANAGER,
                "AUDITOR", ClaimStatus.PENDING_AUDITOR,
                "HEAD",    ClaimStatus.PENDING_HEAD);
        levels.forEach((label, status) -> registry.gauge(
                "expenseflow_pending_claims",
                List.of(io.micrometer.core.instrument.Tag.of("level", label)),
                this, m -> m.count(status)));
        levels.forEach((label, status) -> registry.gauge(
                "expenseflow_oldest_pending_seconds",
                List.of(io.micrometer.core.instrument.Tag.of("level", label)),
                this, m -> m.oldestSeconds(status)));
    }

    private double count(ClaimStatus status) {
        return claims.count((r, q, cb) -> cb.equal(r.get("status"), status));
    }

    private double oldestSeconds(ClaimStatus status) {
        var page = claims.findAll((r, q, cb) -> cb.equal(r.get("status"), status),
                PageRequest.of(0, 1, Sort.by(Sort.Direction.ASC, "submittedAt"))).getContent();
        if (page.isEmpty() || page.get(0).getSubmittedAt() == null) return 0.0;
        return (Instant.now().toEpochMilli() - page.get(0).getSubmittedAt().toEpochMilli()) / 1000.0;
    }
}
