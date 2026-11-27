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
    private final com.expenseflow.repository.ClaimLineRepository claimLines;
    private final ClaimService claimService;

    public ReceiptService(ReceiptRepository repo, CurrentUser current, AuditService audit,
                          com.expenseflow.repository.ClaimLineRepository claimLines, ClaimService claimService) {
        this.repo = repo;
        this.current = current;
        this.audit = audit;
        this.claimLines = claimLines;
        this.claimService = claimService;
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
        // NFR-SEC-4: the declared type must match the file's real signature (no HTML/SVG renamed to .png)
        if (!matchesSignature(type, data)) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "Unsupported file type", "File content is not a valid JPEG, PNG or PDF");
        }
        String sha = sha256(data);

        Long duplicateOf = repo.findFirstBySha256OrderByIdAsc(sha).map(Receipt::getId).orElse(null);

        Receipt r = new Receipt();
        r.setOwner(owner);
        r.setFileName(safeFileName(file.getOriginalFilename()));
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
        // FR-AUTH-4 object-level check: the owner, or anyone who can see a claim that uses this receipt
        // (manager of the claimant, active delegate, AUDITOR, HEAD). Otherwise 404, like claims (R13).
        if (r.getOwner().getId().equals(caller.getId())) return r;
        boolean visibleViaClaim = claimLines.findClaimsUsingReceipt(receiptId).stream()
                .anyMatch(c -> claimService.canView(c, caller));
        if (!visibleViaClaim) {
            throw ApiException.notFound("Receipt not found");
        }
        return r;
    }

    static boolean matchesSignature(String type, byte[] d) {
        if (d == null || d.length < 4) return false;
        return switch (type) {
            case "image/jpeg" -> (d[0] & 0xFF) == 0xFF && (d[1] & 0xFF) == 0xD8 && (d[2] & 0xFF) == 0xFF;
            case "image/png" -> (d[0] & 0xFF) == 0x89 && d[1] == 'P' && d[2] == 'N' && d[3] == 'G';
            case "application/pdf" -> d[0] == '%' && d[1] == 'P' && d[2] == 'D' && d[3] == 'F';
            default -> false;
        };
    }

    /** Strip path parts and control/quote characters (used in Content-Disposition); fits VARCHAR(255). */
    static String safeFileName(String original) {
        if (original == null || original.isBlank()) return "receipt";
        String name = original.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}\"]", "_").trim();
        if (name.isEmpty()) return "receipt";
        return name.length() > 200 ? name.substring(name.length() - 200) : name;
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
