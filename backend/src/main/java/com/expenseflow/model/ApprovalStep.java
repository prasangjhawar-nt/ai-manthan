package com.expenseflow.model;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "approval_steps")
public class ApprovalStep {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "claim_id", nullable = false)
    private Claim claim;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ApprovalLevel level;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "approver_id", nullable = false)
    private Employee approver;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "acted_by_id", nullable = false)
    private Employee actedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ApprovalDecision decision;

    @Column(length = 500)
    private String comment;

    @Column(name = "decided_at", nullable = false, updatable = false, insertable = false)
    private Instant decidedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Claim getClaim() { return claim; }
    public void setClaim(Claim claim) { this.claim = claim; }

    public ApprovalLevel getLevel() { return level; }
    public void setLevel(ApprovalLevel level) { this.level = level; }

    public Employee getApprover() { return approver; }
    public void setApprover(Employee approver) { this.approver = approver; }

    public Employee getActedBy() { return actedBy; }
    public void setActedBy(Employee actedBy) { this.actedBy = actedBy; }

    public ApprovalDecision getDecision() { return decision; }
    public void setDecision(ApprovalDecision decision) { this.decision = decision; }

    public String getComment() { return comment; }
    public void setComment(String comment) { this.comment = comment; }

    public Instant getDecidedAt() { return decidedAt; }
}
