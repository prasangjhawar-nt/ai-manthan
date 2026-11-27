package com.expenseflow.support;

import jakarta.servlet.Filter;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Base class for all integration tests. Spins up a shared postgres:18-alpine
 * container, wires MockMvc by hand (Boot 4 no longer has @AutoConfigureMockMvc),
 * and lets each test use `mvc` to hit controllers.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@ActiveProfiles("test")

public abstract class AbstractIntegrationTest {


    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("expenseflow")
            .withUsername("test")
            .withPassword("test")
            .withCommand("-c", "timezone=UTC")
            .withReuse(true);

    static {
        POSTGRES.start();
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        // The payout retry job polls the DB; disable in tests by setting a long interval.
        r.add("expenseflow.payout.retry-interval-ms", () -> "3600000");
    }

    @Autowired protected WebApplicationContext ctx;
    @Autowired(required = false) protected Filter springSecurityFilterChain;
    @Autowired protected com.expenseflow.filter.CorrelationIdFilter correlationIdFilter;

    protected MockMvc mvc;

    @BeforeEach
    void setUpMvc() {
        // MockMvc only runs the filters added here: correlation id first (as in the servlet container), then security
        var builder = MockMvcBuilders.webAppContextSetup(ctx).addFilters(correlationIdFilter);
        if (springSecurityFilterChain != null) {
            builder = builder.addFilters(springSecurityFilterChain);
        }
        this.mvc = builder.build();
    }
}
