package com.expenseflow.model;

import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;

@Entity
@Table(name = "idempotency_keys",
        uniqueConstraints = @UniqueConstraint(columnNames = {"idem_key", "user_id"}))
public class IdempotencyKey {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "idem_key", nullable = false, length = 80)
    private String idemKey;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private Employee user;

    @Column(nullable = false, length = 128)
    private String endpoint;

    @Column(name = "request_hash", nullable = false, length = 64)
    private String requestHash;

    @Column(name = "response_status", nullable = false)
    private int responseStatus;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "response_body", columnDefinition = "jsonb")
    private Map<String, Object> responseBody;

    @Column(name = "created_at", nullable = false, updatable = false, insertable = false)
    private Instant createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getIdemKey() { return idemKey; }
    public void setIdemKey(String idemKey) { this.idemKey = idemKey; }

    public Employee getUser() { return user; }
    public void setUser(Employee user) { this.user = user; }

    public String getEndpoint() { return endpoint; }
    public void setEndpoint(String endpoint) { this.endpoint = endpoint; }

    public String getRequestHash() { return requestHash; }
    public void setRequestHash(String requestHash) { this.requestHash = requestHash; }

    public int getResponseStatus() { return responseStatus; }
    public void setResponseStatus(int responseStatus) { this.responseStatus = responseStatus; }

    public Map<String, Object> getResponseBody() { return responseBody; }
    public void setResponseBody(Map<String, Object> responseBody) { this.responseBody = responseBody; }

    public Instant getCreatedAt() { return createdAt; }
}
