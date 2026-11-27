package com.expenseflow.controller;

import com.expenseflow.dto.ClaimCreateRequest;
import com.expenseflow.dto.ClaimDto;
import com.expenseflow.dto.ClaimSummaryDto;
import com.expenseflow.dto.ClaimUpdateRequest;
import com.expenseflow.dto.PageDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.ClaimStatus;
import com.expenseflow.service.ClaimService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/claims")
public class ClaimController {

    private final ClaimService claims;

    public ClaimController(ClaimService claims) {
        this.claims = claims;
    }

    @GetMapping
    public PageDto<ClaimSummaryDto> listMine(
            @RequestParam(required = false) ClaimStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        if (size > 100 || size < 1) throw ApiException.badRequest("size must be 1..100");
        return claims.listMine(status, page, size);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ClaimDto create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody ClaimCreateRequest req) {
        return claims.create(req, idempotencyKey);
    }

    @GetMapping("/{id}")
    public ClaimDto get(@PathVariable Long id) {
        return claims.get(id);
    }

    @PutMapping("/{id}")
    public ClaimDto update(@PathVariable Long id, @Valid @RequestBody ClaimUpdateRequest req) {
        return claims.update(id, req);
    }

    @PostMapping("/{id}/submit")
    public ClaimDto submit(@PathVariable Long id,
                           @RequestHeader("Idempotency-Key") String idempotencyKey) {
        return claims.submit(id, idempotencyKey);
    }
}
