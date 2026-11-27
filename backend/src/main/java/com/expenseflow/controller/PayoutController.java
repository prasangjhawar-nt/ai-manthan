package com.expenseflow.controller;

import com.expenseflow.dto.ClaimSummaryDto;
import com.expenseflow.dto.PageDto;
import com.expenseflow.dto.PayoutBatchDto;
import com.expenseflow.dto.PayoutBatchRequest;
import com.expenseflow.model.PayoutBatch;
import com.expenseflow.model.PayoutBatchStatus;
import com.expenseflow.service.PayoutService;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;

@RestController
@RequestMapping("/api")
public class PayoutController {

    private final PayoutService payouts;

    public PayoutController(PayoutService payouts) {
        this.payouts = payouts;
    }

    @GetMapping("/payout/eligible")
    public PageDto<ClaimSummaryDto> eligible(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return payouts.eligible(page, size);
    }

    @GetMapping("/payout-batches")
    public PageDto<PayoutBatchDto> list(
            @RequestParam(required = false) PayoutBatchStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return payouts.list(status, page, size);
    }

    @PostMapping("/payout-batches")
    @ResponseStatus(HttpStatus.CREATED)
    public PayoutBatchDto create(@RequestHeader("Idempotency-Key") String idemKey,
                                 @Valid @RequestBody PayoutBatchRequest req) {
        return payouts.create(req.claimIds(), idemKey);
    }

    @GetMapping("/payout-batches/{id}")
    public PayoutBatchDto get(@PathVariable Long id) {
        return payouts.get(id);
    }

    @GetMapping("/payout-batches/{id}/file")
    public ResponseEntity<byte[]> file(@PathVariable Long id) {
        PayoutBatch b = payouts.loadForFile(id);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "text/csv; charset=utf-8")
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + b.getFileName() + "\"")
                .body(b.getCsvContent().getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/payout-batches/{id}/retry")
    public PayoutBatchDto retry(@PathVariable Long id) {
        return payouts.retry(id);
    }
}
