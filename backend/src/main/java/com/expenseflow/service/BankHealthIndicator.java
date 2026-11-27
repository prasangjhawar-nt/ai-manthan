package com.expenseflow.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component("bank")
public class BankHealthIndicator implements HealthIndicator {

    private final RestClient client;
    private final String baseUrl;

    public BankHealthIndicator(@Value("${expenseflow.bank.base-url}") String baseUrl,
                               @Value("${expenseflow.bank.timeout-ms}") int timeoutMs) {
        this.baseUrl = baseUrl;
        // devops.md 6.2: probe GET /bank/health with a 1 s timeout (never longer than the bank timeout)
        java.time.Duration t = java.time.Duration.ofMillis(Math.min(1000, timeoutMs));
        var http = java.net.http.HttpClient.newBuilder().connectTimeout(t).build();
        var factory = new org.springframework.http.client.JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(t);
        this.client = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .build();
    }

    @Override
    public Health health() {
        try {
            client.get()
                    .uri("/bank/health")
                    .retrieve()
                    .toBodilessEntity();
            return Health.up().withDetail("baseUrl", baseUrl).build();
        } catch (Exception e) {
            return Health.down()
                    .withDetail("baseUrl", baseUrl)
                    .withDetail("error", e.getClass().getSimpleName())
                    .build();
        }
    }
}
