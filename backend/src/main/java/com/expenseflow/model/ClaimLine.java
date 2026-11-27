package com.expenseflow.model;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "claim_lines",
        uniqueConstraints = @UniqueConstraint(columnNames = {"claim_id", "line_no"}))
public class ClaimLine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "claim_id", nullable = false)
    private Claim claim;

    @Column(name = "line_no", nullable = false)
    private short lineNo;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Category category;

    @Column(name = "expense_date", nullable = false)
    private LocalDate expenseDate;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(nullable = false, length = 120)
    private String vendor;

    @Column(length = 64)
    private String city;

    @Column
    private Short nights;

    @Column(length = 500)
    private String description;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "receipt_id")
    private Receipt receipt;

    @Enumerated(EnumType.STRING)
    @Column(length = 16)
    private LineOutcome outcome;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "text[]", nullable = false)
    private List<String> flags = new ArrayList<>();

    @Column(length = 500)
    private String reason;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Claim getClaim() { return claim; }
    public void setClaim(Claim claim) { this.claim = claim; }

    public short getLineNo() { return lineNo; }
    public void setLineNo(short lineNo) { this.lineNo = lineNo; }

    public Category getCategory() { return category; }
    public void setCategory(Category category) { this.category = category; }

    public LocalDate getExpenseDate() { return expenseDate; }
    public void setExpenseDate(LocalDate expenseDate) { this.expenseDate = expenseDate; }

    public BigDecimal getAmount() { return amount; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }

    public String getVendor() { return vendor; }
    public void setVendor(String vendor) { this.vendor = vendor; }

    public String getCity() { return city; }
    public void setCity(String city) { this.city = city; }

    public Short getNights() { return nights; }
    public void setNights(Short nights) { this.nights = nights; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public Receipt getReceipt() { return receipt; }
    public void setReceipt(Receipt receipt) { this.receipt = receipt; }

    public LineOutcome getOutcome() { return outcome; }
    public void setOutcome(LineOutcome outcome) { this.outcome = outcome; }

    public List<String> getFlags() { return flags; }
    public void setFlags(List<String> flags) { this.flags = flags; }

    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
}
