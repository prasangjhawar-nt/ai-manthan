package com.expenseflow.service;

import com.expenseflow.dto.ClaimSummaryDto;
import com.expenseflow.dto.PageDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Employee;
import com.expenseflow.model.Role;
import com.expenseflow.repository.ClaimRepository;
import com.expenseflow.repository.DelegationRepository;
import com.expenseflow.security.CurrentUser;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

@Service
public class QueueService {

    private final ClaimRepository claims;
    private final DelegationRepository delegations;
    private final CurrentUser current;
    private final ClaimService claimService;

    public QueueService(ClaimRepository claims, DelegationRepository delegations,
                        CurrentUser current, ClaimService claimService) {
        this.claims = claims;
        this.delegations = delegations;
        this.current = current;
        this.claimService = claimService;
    }

    @Transactional(readOnly = true)
    public PageDto<ClaimSummaryDto> queue(Long departmentId,
                                          com.expenseflow.model.Category category,
                                          String flag,
                                          ClaimStatus status,
                                          BigDecimal minAmount,
                                          BigDecimal maxAmount,
                                          LocalDate submittedFrom,
                                          LocalDate submittedTo,
                                          boolean sampleAuditOnly,
                                          int page, int size) {
        Employee me = current.employee();
        Role role = me.getRole();
        if (role == Role.EMPLOYEE) throw ApiException.forbidden("Role not allowed");

        Specification<Claim> spec = roleQueueSpec(role, me);

        if (departmentId != null) {
            spec = spec.and((r, q, cb) -> cb.equal(r.get("employee").get("department").get("id"), departmentId));
        }
        if (category != null) {
            spec = spec.and((r, q, cb) -> {
                q.distinct(true);
                return cb.equal(r.join("lines").get("category"), category);
            });
        }
        if (flag != null) {
            final String f = flag;
            spec = spec.and((r, q, cb) -> {
                q.distinct(true);
                var line = r.join("lines");
                // Postgres: 'FLAG' = ANY(line.flags). Use array_position(..) IS NOT NULL.
                return cb.isNotNull(cb.function("array_position", Integer.class,
                        line.get("flags"), cb.literal(f)));
            });
        }
        if (status != null) {
            spec = spec.and((r, q, cb) -> cb.equal(r.get("status"), status));
        }
        if (minAmount != null) {
            spec = spec.and((r, q, cb) -> cb.greaterThanOrEqualTo(r.get("totalAmount"), minAmount));
        }
        if (maxAmount != null) {
            spec = spec.and((r, q, cb) -> cb.lessThanOrEqualTo(r.get("totalAmount"), maxAmount));
        }
        if (submittedFrom != null) {
            Instant from = submittedFrom.atStartOfDay(ZoneOffset.UTC).toInstant();
            spec = spec.and((r, q, cb) -> cb.greaterThanOrEqualTo(r.get("submittedAt"), from));
        }
        if (submittedTo != null) {
            Instant to = submittedTo.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
            spec = spec.and((r, q, cb) -> cb.lessThan(r.get("submittedAt"), to));
        }
        if (sampleAuditOnly) {
            spec = spec.and((r, q, cb) -> cb.equal(r.get("sampleAudit"), com.expenseflow.model.SampleAuditStatus.OPEN));
        }

        PageRequest pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "submittedAt"));
        Page<Claim> result = claims.findAll(spec, pageable);
        return PageDto.of(result, c -> ClaimSummaryDto.from(c, claimService.waitingHours(c)));
    }

    private Specification<Claim> roleQueueSpec(Role role, Employee me) {
        return switch (role) {
            case MANAGER -> (root, q, cb) -> {
                List<Long> delegators = delegations.findApproverIdsForActiveDelegate(me.getId(), LocalDate.now());
                List<Long> managerIds = new ArrayList<>(delegators);
                managerIds.add(me.getId());
                Predicate mgrMatch = root.get("employee").get("manager").get("id").in(managerIds);
                return cb.and(cb.equal(root.get("status"), ClaimStatus.PENDING_MANAGER), mgrMatch);
            };
            case AUDITOR -> (root, q, cb) -> cb.or(
                    cb.equal(root.get("status"), ClaimStatus.PENDING_AUDITOR),
                    cb.and(
                            cb.equal(root.get("status"), ClaimStatus.APPROVED),
                            cb.equal(root.get("sampleAudit"), com.expenseflow.model.SampleAuditStatus.OPEN)
                    )
            );
            case HEAD -> (root, q, cb) -> cb.equal(root.get("status"), ClaimStatus.PENDING_HEAD);
            case EMPLOYEE -> (root, q, cb) -> cb.disjunction();
        };
    }
}
