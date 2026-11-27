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
            @SuppressWarnings("unchecked")
            Map<String, Object> asMap = mapper.convertValue(responseBody, Map.class);
            row.setResponseBody(asMap);
        }
        repo.save(row);
    }

    public <T> T decode(IdempotencyKey existing, Class<T> type) {
        return mapper.convertValue(existing.getResponseBody(), type);
    }
}
