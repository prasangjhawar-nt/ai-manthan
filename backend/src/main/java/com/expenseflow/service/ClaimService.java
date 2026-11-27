package com.expenseflow.service;

import com.expenseflow.dto.ApprovalStepDto;
import com.expenseflow.dto.ClaimCreateRequest;
import com.expenseflow.dto.ClaimDto;
import com.expenseflow.dto.ClaimLineInput;
import com.expenseflow.dto.ClaimSummaryDto;
import com.expenseflow.dto.ClaimUpdateRequest;
import com.expenseflow.dto.PageDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Category;
import com.expenseflow.model.Claim;
import com.expenseflow.model.ClaimLine;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.model.Employee;
import com.expenseflow.model.IdempotencyKey;
import com.expenseflow.model.Receipt;
import com.expenseflow.model.SampleAuditStatus;
import com.expenseflow.repository.ApprovalStepRepository;
import com.expenseflow.repository.ClaimRepository;
import com.expenseflow.repository.DelegationRepository;
import com.expenseflow.repository.ReceiptRepository;
import com.expenseflow.security.CurrentUser;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
public class ClaimService {

    private final ClaimRepository claims;
    private final ReceiptRepository receipts;
    private final ApprovalStepRepository steps;
    private final ClaimNumberGenerator numbers;
    private final CurrentUser current;
    private final AuditService audit;
    private final PolicyEngine policy;
    private final IdempotencyService idem;
    private final DelegationRepository delegations;

    public ClaimService(ClaimRepository claims, ReceiptRepository receipts,
                        ApprovalStepRepository steps, ClaimNumberGenerator numbers,
                        CurrentUser current, AuditService audit, PolicyEngine policy,
                        IdempotencyService idem, DelegationRepository delegations) {
        this.claims = claims;
        this.receipts = receipts;
        this.steps = steps;
        this.numbers = numbers;
        this.current = current;
        this.audit = audit;
        this.policy = policy;
        this.idem = idem;
        this.delegations = delegations;
    }

    // ---------- create / update / list / get ----------

    @Transactional
    public ClaimDto create(ClaimCreateRequest req, String idempotencyKey) {
        Employee me = current.employee();
        String bodyHash = idem.hashBody(req);
        idem.acquire(idempotencyKey, me.getId());
        Optional<IdempotencyKey> existing = idem.findExisting(idempotencyKey, me.getId());
        if (existing.isPresent()) {
            idem.assertSameBody(existing.get(), bodyHash);
            idem.markReplay();
            return idem.decode(existing.get(), ClaimDto.class);
        }

        Claim c = new Claim();
        c.setClaimNumber(numbers.next());
        c.setEmployee(me);
        c.setTitle(req.title());
        c.setStatus(ClaimStatus.DRAFT);
        c.setSampleAudit(SampleAuditStatus.NONE);
        applyLines(c, req.lines());
        Claim saved = claims.save(c);

        audit.record(AuditService.Action.CLAIM_CREATED, AuditService.EntityType.CLAIM,
                saved.getId(), saved.getId(), me, null, null, ClaimStatus.DRAFT,
                Map.of("lines", req.lines().size()));

        ClaimDto dto = ClaimDto.from(saved, List.of());
        idem.store(idempotencyKey, me.getId(), "POST /api/claims", bodyHash, 201, dto);
        return dto;
    }

    @Transactional
    public ClaimDto update(Long id, ClaimUpdateRequest req) {
        Employee me = current.employee();
        Claim c = loadOwned(id, me);
        if (c.getStatus() != ClaimStatus.DRAFT && c.getStatus() != ClaimStatus.NEEDS_CLARIFICATION) {
            throw ApiException.conflict("Claim is not editable in status " + c.getStatus());
        }
        if (!req.version().equals(c.getVersion())) {
            throw ApiException.conflict("Claim was modified by another request");
        }
        c.setTitle(req.title());
        c.getLines().clear();
        // delete the old lines now: otherwise the new line_no 1..n are inserted first and hit
        // UNIQUE (claim_id, line_no) -> every edit failed (FR-CLM-5, FR-APR-3 edit + resubmit)
        claims.flush();
        applyLines(c, req.lines());
        Claim saved = claims.saveAndFlush(c);   // flushed so the response carries the new version

        audit.record(AuditService.Action.CLAIM_UPDATED, AuditService.EntityType.CLAIM,
                saved.getId(), saved.getId(), me, null, c.getStatus(), c.getStatus(),
                Map.of("lines", req.lines().size()));

        return toDto(saved);
    }

    @Transactional(readOnly = true)
    public ClaimDto get(Long id) {
        Employee me = current.employee();
        Claim c = loadVisible(id, me);
        return toDto(c);
    }

    @Transactional(readOnly = true)
    public PageDto<ClaimSummaryDto> listMine(ClaimStatus status, int page, int size) {
        Employee me = current.employee();
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Claim> result = status == null
                ? claims.findByEmployeeId(me.getId(), pageable)
                : claims.findByEmployeeIdAndStatus(me.getId(), status, pageable);
        return PageDto.of(result, c -> ClaimSummaryDto.from(c, waitingHours(c)));
    }

    // ---------- submit (idempotent) ----------

    @Transactional
    public ClaimDto submit(Long id, String idempotencyKey) {
        Employee me = current.employee();
        String endpoint = "POST /api/claims/" + id + "/submit";
        String bodyHash = idem.hashString(endpoint);
        idem.acquire(idempotencyKey, me.getId());   // a parallel double-click waits, then replays (FR-CLM-7)
        Optional<IdempotencyKey> existing = idem.findExisting(idempotencyKey, me.getId());
        if (existing.isPresent()) {
            idem.assertSameBody(existing.get(), bodyHash);
            idem.markReplay();
            return idem.decode(existing.get(), ClaimDto.class);
        }

        Claim c = loadOwned(id, me);
        if (c.getStatus() != ClaimStatus.DRAFT && c.getStatus() != ClaimStatus.NEEDS_CLARIFICATION) {
            throw ApiException.conflict("Claim cannot be submitted in status " + c.getStatus());
        }
        if (c.getLines().isEmpty()) {
            throw ApiException.badRequest("Submit requires at least one line");
        }

        ClaimStatus prior = c.getStatus();
        c.setStatus(ClaimStatus.SUBMITTED);
        c.setSubmittedAt(Instant.now());

        PolicyEngine.Result result = policy.evaluate(c);

        StatusFlow.assertTransition(ClaimStatus.SUBMITTED, result.targetStatus());
        c.setStatus(result.targetStatus());
        if (result.targetStatus() == ClaimStatus.APPROVED) {
            c.setFinalDecisionAt(Instant.now());
            if (result.sampleAudit()) {
                c.setSampleAudit(SampleAuditStatus.OPEN);
            }
        } else if (result.targetStatus() == ClaimStatus.REJECTED) {
            c.setFinalDecisionAt(Instant.now());
        }

        Claim saved = claims.save(c);
        audit.record(AuditService.Action.CLAIM_SUBMITTED, AuditService.EntityType.CLAIM,
                saved.getId(), saved.getId(), me, null, prior, result.targetStatus(),
                Map.of("total", saved.getTotalAmount(), "flags", collectFlags(saved)));
        audit.record(AuditService.Action.POLICY_EVALUATED, AuditService.EntityType.CLAIM,
                saved.getId(), saved.getId(), null, null, null, result.targetStatus(),
                Map.of("sampleAudit", result.sampleAudit()));

        ClaimDto dto = toDto(saved);
        idem.store(idempotencyKey, me.getId(), endpoint, bodyHash, 200, dto);
        return dto;
    }

    // ---------- helpers ----------

    public Claim loadVisible(Long id, Employee caller) {
        Claim c = claims.findByIdWithEmployee(id)
                .orElseThrow(() -> ApiException.notFound("Claim not found"));
        if (!canView(c, caller)) {
            throw ApiException.notFound("Claim not found");
        }
        return c;
    }

    /** README 2.1: own; MANAGER = direct reports' + delegated; AUDITOR/HEAD = all. Everything else is 404. */
    public boolean canView(Claim c, Employee caller) {
        if (c.getEmployee().getId().equals(caller.getId())) return true;
        if (caller.getRole() == com.expenseflow.model.Role.AUDITOR
                || caller.getRole() == com.expenseflow.model.Role.HEAD) return true;
        Employee manager = c.getEmployee().getManager();
        if (manager == null) return false;
        if (manager.getId().equals(caller.getId())) return true;
        // R10: an active delegate of the claimant's manager sees (and may act on) the claim
        return delegations.isActiveDelegate(manager.getId(), caller.getId(), LocalDate.now());
    }

    /**
     * For approve / send back / reject: like loadVisible, but a delegate of the claimant's manager whose
     * delegation is expired or not yet active still "sees" it, so the action fails with 403 (FR-APR-5)
     * instead of 404. Everyone else gets 404 exactly as for reads (R13).
     */
    public Claim loadForAction(Long id, Employee caller) {
        Claim c = claims.findByIdWithEmployee(id)
                .orElseThrow(() -> ApiException.notFound("Claim not found"));
        if (canView(c, caller)) return c;
        Employee manager = c.getEmployee().getManager();
        if (manager != null && delegations.existsByApprover_IdAndDelegate_Id(manager.getId(), caller.getId())) {
            return c;
        }
        throw ApiException.notFound("Claim not found");
    }

    public Claim loadOwned(Long id, Employee caller) {
        Claim c = loadVisible(id, caller);
        if (!c.getEmployee().getId().equals(caller.getId())) {
            throw ApiException.forbidden("Not the owner");
        }
        return c;
    }

    private void applyLines(Claim claim, List<ClaimLineInput> inputs) {
        short no = 1;
        for (ClaimLineInput in : inputs) {
            ClaimLine line = new ClaimLine();
            line.setClaim(claim);
            line.setLineNo(no++);
            line.setCategory(in.category());
            line.setExpenseDate(in.expenseDate());
            line.setAmount(in.amount());
            line.setVendor(in.vendor());
            line.setCity(in.city());
            line.setNights(in.nights() == null ? null : in.nights().shortValue());
            line.setDescription(in.description());
            if (in.receiptId() != null) {
                // only the claimant's own receipts can be attached (no attaching/viewing other people's files)
                Receipt r = receipts.findById(in.receiptId())
                        .filter(x -> x.getOwner().getId().equals(claim.getEmployee().getId()))
                        .orElseThrow(() -> ApiException.badRequest("Receipt " + in.receiptId() + " not found"));
                line.setReceipt(r);
            }
            validateLine(line);
            claim.getLines().add(line);
        }
        BigDecimal total = claim.getLines().stream()
                .map(ClaimLine::getAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        claim.setTotalAmount(total);
    }

    private void validateLine(ClaimLine l) {
        LocalDate today = LocalDate.now();
        if (l.getExpenseDate().isAfter(today)) {
            throw ApiException.badRequest("expenseDate cannot be in the future");
        }
        if (l.getExpenseDate().isBefore(today.minusDays(90))) {
            throw ApiException.badRequest("expenseDate cannot be older than 90 days");
        }
        if (l.getCategory() == Category.HOTEL) {
            if (l.getCity() == null || l.getCity().isBlank()) {
                throw ApiException.badRequest("HOTEL lines require city");
            }
            if (l.getNights() == null || l.getNights() < 1) {
                throw ApiException.badRequest("HOTEL lines require nights");
            }
        }
    }

    public ClaimDto toDto(Claim c) {
        var stepList = steps.findByClaimIdOrderByDecidedAt(c.getId())
                .stream().map(ApprovalStepDto::from).toList();
        return ClaimDto.from(c, stepList);
    }

    private List<String> collectFlags(Claim c) {
        return c.getLines().stream()
                .flatMap(l -> l.getFlags().stream())
                .distinct()
                .toList();
    }

    public Double waitingHours(Claim c) {
        if (c.getStatus() != ClaimStatus.PENDING_MANAGER
                && c.getStatus() != ClaimStatus.PENDING_AUDITOR
                && c.getStatus() != ClaimStatus.PENDING_HEAD) {
            return null;
        }
        Instant since = c.getSubmittedAt();
        if (c.getStatus() != ClaimStatus.PENDING_MANAGER) {
            var last = steps.findMostRecentApproval(c.getId());
            if (last.isPresent()) since = last.get().getDecidedAt();
        }
        if (since == null) return null;
        return (Instant.now().toEpochMilli() - since.toEpochMilli()) / 3_600_000.0;
    }
}
