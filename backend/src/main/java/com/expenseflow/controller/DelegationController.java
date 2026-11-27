package com.expenseflow.controller;

import com.expenseflow.dto.DelegationDto;
import com.expenseflow.dto.DelegationRequest;
import com.expenseflow.service.DelegationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/delegations")
public class DelegationController {

    private final DelegationService delegations;

    public DelegationController(DelegationService delegations) {
        this.delegations = delegations;
    }

    @GetMapping
    public List<DelegationDto> list() {
        return delegations.listMine();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public DelegationDto create(@Valid @RequestBody DelegationRequest req) {
        return delegations.create(req);
    }
}
