package com.expenseflow.service;

import com.expenseflow.dto.DelegationDto;
import com.expenseflow.dto.DelegationRequest;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Delegation;
import com.expenseflow.model.Employee;
import com.expenseflow.model.Role;
import com.expenseflow.repository.DelegationRepository;
import com.expenseflow.repository.EmployeeRepository;
import com.expenseflow.security.CurrentUser;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

@Service
public class DelegationService {

    private final DelegationRepository delegations;
    private final EmployeeRepository employees;
    private final CurrentUser current;
    private final AuditService audit;

    public DelegationService(DelegationRepository delegations, EmployeeRepository employees,
                             CurrentUser current, AuditService audit) {
        this.delegations = delegations;
        this.employees = employees;
        this.current = current;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<DelegationDto> listMine() {
        Employee me = current.employee();
        return delegations.findByUser(me.getId()).stream().map(DelegationDto::from).toList();
    }

    @Transactional
    public DelegationDto create(DelegationRequest req) {
        Employee me = current.employee();
        if (me.getRole() == Role.EMPLOYEE) {
            throw ApiException.forbidden("Role not allowed");
        }
        if (req.delegateId().equals(me.getId())) {
            throw ApiException.badRequest("Cannot delegate to yourself");
        }
        if (req.toDate().isBefore(req.fromDate())) {
            throw ApiException.badRequest("toDate must be on or after fromDate");
        }
        Employee delegate = employees.findById(req.delegateId())
                .orElseThrow(() -> ApiException.badRequest("Delegate not found"));
        Delegation d = new Delegation();
        d.setApprover(me);
        d.setDelegate(delegate);
        d.setFromDate(req.fromDate());
        d.setToDate(req.toDate());
        Delegation saved = delegations.save(d);

        audit.record(AuditService.Action.DELEGATION_CREATED, AuditService.EntityType.DELEGATION,
                saved.getId(), null, me, null, null, null,
                Map.of("delegateId", delegate.getId(),
                       "from", req.fromDate().toString(),
                       "to", req.toDate().toString()));

        return DelegationDto.from(saved);
    }
}
