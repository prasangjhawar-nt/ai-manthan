package com.expenseflow.config;

import org.flywaydb.core.Flyway;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

/**
 * Programmatic Flyway runner. Spring Boot 4 autoconfig for Flyway hasn't been
 * reliable with our setup, so we instantiate the migrator ourselves and ensure
 * it runs BEFORE the JPA entity manager factory starts (via @DependsOn on the
 * entityManagerFactory bean declaration elsewhere, or via Flyway init here).
 */
@Configuration
public class FlywayConfig {

    @Bean(initMethod = "migrate")
    public Flyway flyway(DataSource dataSource) {
        return Flyway.configure()
                .dataSource(dataSource)
                .locations("classpath:db/migration")
                .baselineOnMigrate(true)
                .load();
    }
}
