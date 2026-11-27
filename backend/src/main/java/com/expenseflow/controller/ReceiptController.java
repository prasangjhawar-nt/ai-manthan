package com.expenseflow.controller;

import com.expenseflow.dto.ReceiptUploadDto;
import com.expenseflow.model.Receipt;
import com.expenseflow.service.ReceiptService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/receipts")
public class ReceiptController {

    private final ReceiptService receipts;

    public ReceiptController(ReceiptService receipts) {
        this.receipts = receipts;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public ReceiptUploadDto upload(@RequestPart("file") MultipartFile file) {
        return receipts.upload(file);
    }

    @GetMapping("/{id}/content")
    public ResponseEntity<byte[]> download(@PathVariable Long id) {
        Receipt r = receipts.getForDownload(id);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, r.getContentType())
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"" + r.getFileName() + "\"")
                .body(r.getData());
    }
}
