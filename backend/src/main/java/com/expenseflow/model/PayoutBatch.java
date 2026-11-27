package com.expenseflow.model;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "payout_batches")
public class PayoutBatch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "batch_ref", nullable = false, unique = true, length = 32)
    private String batchRef;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private PayoutBatchStatus status;

    @Column(name = "claim_count", nullable = false)
    private int claimCount;

    @Column(name = "total_amount", nullable = false, precision = 14, scale = 2)
    private BigDecimal totalAmount;

    @Column(name = "file_name", nullable = false, length = 255)
    private String fileName;

    @Column(name = "csv_content", nullable = false, columnDefinition = "text")
    private String csvContent;

    @Column(nullable = false)
    private int attempts = 0;

    @Column(name = "last_error", length = 500)
    private String lastError;

    @Column(name = "bank_reference", length = 64)
    private String bankReference;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by", nullable = false)
    private Employee createdBy;

    @Column(name = "created_at", nullable = false, updatable = false, insertable = false)
    private Instant createdAt;

    @Column(name = "sent_at")
    private Instant sentAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getBatchRef() { return batchRef; }
    public void setBatchRef(String batchRef) { this.batchRef = batchRef; }

    public PayoutBatchStatus getStatus() { return status; }
    public void setStatus(PayoutBatchStatus status) { this.status = status; }

    public int getClaimCount() { return claimCount; }
    public void setClaimCount(int claimCount) { this.claimCount = claimCount; }

    public BigDecimal getTotalAmount() { return totalAmount; }
    public void setTotalAmount(BigDecimal totalAmount) { this.totalAmount = totalAmount; }

    public String getFileName() { return fileName; }
    public void setFileName(String fileName) { this.fileName = fileName; }

    public String getCsvContent() { return csvContent; }
    public void setCsvContent(String csvContent) { this.csvContent = csvContent; }

    public int getAttempts() { return attempts; }
    public void setAttempts(int attempts) { this.attempts = attempts; }

    public String getLastError() { return lastError; }
    public void setLastError(String lastError) { this.lastError = lastError; }

    public String getBankReference() { return bankReference; }
    public void setBankReference(String bankReference) { this.bankReference = bankReference; }

    public Employee getCreatedBy() { return createdBy; }
    public void setCreatedBy(Employee createdBy) { this.createdBy = createdBy; }

    public Instant getCreatedAt() { return createdAt; }

    public Instant getSentAt() { return sentAt; }
    public void setSentAt(Instant sentAt) { this.sentAt = sentAt; }
}
