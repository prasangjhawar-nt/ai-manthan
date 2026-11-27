package com.expenseflow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Optional;

@Service
public class BankClient {

    private static final Logger log = LoggerFactory.getLogger(BankClient.class);

    private final RestClient client;
    private final ObjectMapper mapper;
    private final Timer okTimer;
    private final Timer failTimer;

    public BankClient(@Value("${expenseflow.bank.base-url}") String baseUrl,
                      @Value("${expenseflow.bank.timeout-ms}") int timeoutMs,
                      ObjectMapper mapper, MeterRegistry registry) {
        this.mapper = mapper;
        var httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(timeoutMs))
                .build();
        this.client = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory(httpClient))
                .build();
        this.okTimer = Timer.builder("expenseflow_bank_call_seconds")
                .tag("outcome", "SUCCESS").register(registry);
        this.failTimer = Timer.builder("expenseflow_bank_call_seconds")
                .tag("outcome", "FAILURE").register(registry);
    }

    /** Returns the bankReference on success, empty on failure (caller retries later). */
    public Optional<String> send(String batchRef, String csv) {
        long start = System.nanoTime();
        try {
            String body = client.post()
                    .uri("/bank/payouts")
                    .header("X-Batch-Ref", batchRef)
                    .contentType(MediaType.valueOf("text/csv"))
                    .body(csv)
                    .retrieve()
                    .body(String.class);
            okTimer.record(Duration.ofNanos(System.nanoTime() - start));
            if (body == null || body.isBlank()) return Optional.empty();
            JsonNode node = mapper.readTree(body);
            String ref = node.path("bankReference").asText(null);
            return Optional.ofNullable(ref);
        } catch (Exception e) {
            failTimer.record(Duration.ofNanos(System.nanoTime() - start));
            log.warn("Bank send failed for batch {}: {}", batchRef, e.getMessage());
            return Optional.empty();
        }
    }
}
