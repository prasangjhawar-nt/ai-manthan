package com.expenseflow.controller;

import com.expenseflow.dto.AuditEventDto;
import com.expenseflow.repository.AuditEventRepository;
import com.expenseflow.security.CurrentUser;
import com.expenseflow.service.ClaimService;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/claims/{id}/audit")
public class AuditController {

    private final AuditEventRepository events;
    private final ClaimService claims;
    private final CurrentUser current;

    public AuditController(AuditEventRepository events, ClaimService claims, CurrentUser current) {
        this.events = events;
        this.claims = claims;
        this.current = current;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<AuditEventDto> list(@PathVariable Long id) {
        claims.loadVisible(id, current.employee()); // 404 if not visible
        return events.findByClaimIdOrderByCreatedAt(id).stream().map(AuditEventDto::from).toList();
    }
}
