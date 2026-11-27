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
        this.client = RestClient.builder()
                .baseUrl(baseUrl)
                .build();
    }

    @Override
    public Health health() {
        try {
            client.get()
                    .uri("/__admin/health")
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
