package com.expenseflow.service;

import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Employee;
import com.expenseflow.model.IdempotencyKey;
import com.expenseflow.repository.EmployeeRepository;
import com.expenseflow.repository.IdempotencyKeyRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;

/**
 * Idempotent writes: the first call runs the body and stores the response under
 * (idemKey, userId). Replays with the same key and body hash return the stored
 * response. Replays with the same key but a different body hash return 409.
 */
@Service
public class IdempotencyService {

    private final IdempotencyKeyRepository repo;
    private final EmployeeRepository employeeRepo;
    private final ObjectMapper mapper;
    private final Counter replays;

    public IdempotencyService(IdempotencyKeyRepository repo,
                              EmployeeRepository employeeRepo,
                              ObjectMapper mapper,
                              MeterRegistry registry) {
        this.repo = repo;
        this.employeeRepo = employeeRepo;
        this.mapper = mapper;
        this.replays = Counter.builder("expenseflow_idempotent_replays_total")
                .description("Idempotent requests served from the stored response")
                .register(registry);
    }

    public String hashBody(Object body) {
        try {
            byte[] bytes = (body == null)
                    ? new byte[0]
                    : mapper.writeValueAsBytes(body);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(bytes));
        } catch (JsonProcessingException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Hash failed", e);
        }
    }

    public String hashString(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest((s == null ? "" : s).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager em;

    /**
     * Serialises requests with the same (user, Idempotency-Key) across replicas until the current transaction
     * ends: a parallel duplicate (double click) waits, then finds the stored key and gets the same response
     * instead of a 409 (FR-CLM-7). Must be called inside a transaction, before findExisting().
     */
    public void acquire(String key, Long userId) {
        em.createNativeQuery("SELECT pg_advisory_xact_lock(hashtextextended(:k, 0))")
                .setParameter("k", userId + ":" + key)
                .getSingleResult();
    }

    /** Replace the stored response (payout: the final state after the bank call is what a replay returns). */
    @Transactional
    public <T> void updateResponse(String key, Long userId, T responseBody) {
        repo.findByIdemKeyAndUserId(key, userId).ifPresent(row -> {
            try {
                row.setResponseBody(mapper.writeValueAsString(responseBody));
            } catch (JsonProcessingException e) {
                throw new IllegalStateException("Could not store idempotent response", e);
            }
            repo.save(row);
        });
    }

    public Optional<IdempotencyKey> findExisting(String key, Long userId) {
        return repo.findByIdemKeyAndUserId(key, userId);
    }

    public void assertSameBody(IdempotencyKey existing, String requestHash) {
        if (!existing.getRequestHash().equals(requestHash)) {
            throw ApiException.conflict("Idempotency-Key reused with a different payload");
        }
    }

    public void markReplay() {
        replays.increment();
    }

    @Transactional
    public <T> void store(String key, Long userId, String endpoint, String requestHash,
                          int status, T responseBody) {
        Employee user = employeeRepo.findById(userId)
                .orElseThrow(() -> ApiException.unauthorized("User not found"));
        IdempotencyKey row = new IdempotencyKey();
        row.setIdemKey(key);
        row.setUser(user);
        row.setEndpoint(endpoint);
        row.setRequestHash(requestHash);
        row.setResponseStatus(status);
        if (responseBody != null) {
            try {
                row.setResponseBody(mapper.writeValueAsString(responseBody));
            } catch (JsonProcessingException e) {
                throw new IllegalStateException("Could not store idempotent response", e);
            }
        }
        repo.save(row);
    }

    /** Same response as the first call: exact decimals (420.00) and timestamps, parsed from the stored JSON text. */
    public <T> T decode(IdempotencyKey existing, Class<T> type) {
        try {
            return existing.getResponseBody() == null ? null : mapper.readValue(existing.getResponseBody(), type);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored idempotent response is unreadable", e);
        }
    }
}
