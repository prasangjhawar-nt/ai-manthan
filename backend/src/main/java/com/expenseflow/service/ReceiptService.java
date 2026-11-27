package com.expenseflow.service;

import com.expenseflow.dto.ReceiptUploadDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Employee;
import com.expenseflow.model.Receipt;
import com.expenseflow.repository.ReceiptRepository;
import com.expenseflow.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;

@Service
public class ReceiptService {

    private static final Set<String> ALLOWED_TYPES = Set.of("image/jpeg", "image/png", "application/pdf");
    private static final int MAX_BYTES = 5 * 1024 * 1024;

    private final ReceiptRepository repo;
    private final CurrentUser current;
    private final AuditService audit;

    public ReceiptService(ReceiptRepository repo, CurrentUser current, AuditService audit) {
        this.repo = repo;
        this.current = current;
        this.audit = audit;
    }

    @Transactional
    public ReceiptUploadDto upload(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("File is required");
        }
        String type = file.getContentType();
        if (type == null || !ALLOWED_TYPES.contains(type)) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "Unsupported file type", "Only JPEG, PNG or PDF");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "File too large", "Max 5 MB");
        }

        Employee owner = current.employee();

        byte[] data;
        try {
            data = file.getBytes();
        } catch (IOException e) {
            throw ApiException.badRequest("Could not read upload");
        }
        String sha = sha256(data);

        // Check duplicate BEFORE saving so we don't match the new row against itself.
        Long duplicateOf = repo.findFirstBySha256OrderByIdAsc(sha).map(Receipt::getId).orElse(null);

        Receipt r = new Receipt();
        r.setOwner(owner);
        r.setFileName(file.getOriginalFilename() == null ? "receipt" : file.getOriginalFilename());
        r.setContentType(type);
        r.setSizeBytes((int) file.getSize());
        r.setSha256(sha);
        r.setData(data);
        Receipt saved = repo.save(r);

        audit.record(AuditService.Action.RECEIPT_UPLOADED, AuditService.EntityType.RECEIPT,
                saved.getId(), null, owner, null, null, null,
                Map.of("sha256", sha, "sizeBytes", saved.getSizeBytes()));

        return new ReceiptUploadDto(
                saved.getId(),
                saved.getFileName(),
                saved.getContentType(),
                saved.getSizeBytes(),
                saved.getSha256(),
                duplicateOf,
                saved.getUploadedAt()
        );
    }

    @Transactional(readOnly = true)
    public Receipt getForDownload(Long receiptId) {
        Receipt r = repo.findById(receiptId)
                .orElseThrow(() -> ApiException.notFound("Receipt not found"));
        Employee caller = current.employee();
        // Visible to the owner or to roles that see claims using it (MANAGER/AUDITOR/HEAD).
        // Full object-level check happens via claim; we approximate: owner always; others may view.
        if (!r.getOwner().getId().equals(caller.getId())
                && caller.getRole() == com.expenseflow.model.Role.EMPLOYEE) {
            throw ApiException.notFound("Receipt not found");
        }
        return r;
    }

    private String sha256(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
