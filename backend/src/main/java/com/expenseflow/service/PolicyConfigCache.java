package com.expenseflow.service;

import com.expenseflow.model.AppSetting;
import com.expenseflow.model.CityTier;
import com.expenseflow.model.PolicyRule;
import com.expenseflow.repository.AppSettingRepository;
import com.expenseflow.repository.CityTierRepository;
import com.expenseflow.repository.PolicyRuleRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Caches policy rules, settings and tier-1 cities for up to cacheTtlSeconds.
 * Read-heavy and refreshed on access after expiry.
 */
@Component
public class PolicyConfigCache {

    private final PolicyRuleRepository rules;
    private final AppSettingRepository settings;
    private final CityTierRepository cities;
    private final Duration ttl;

    private volatile Snapshot snapshot;

    public PolicyConfigCache(PolicyRuleRepository rules, AppSettingRepository settings,
                             CityTierRepository cities,
                             @Value("${expenseflow.policy.cache-ttl-seconds:60}") int ttlSeconds) {
        this.rules = rules;
        this.settings = settings;
        this.cities = cities;
        this.ttl = Duration.ofSeconds(ttlSeconds);
    }

    public synchronized Snapshot get() {
        if (snapshot == null || snapshot.loadedAt.plus(ttl).isBefore(Instant.now())) {
            snapshot = load();
        }
        return snapshot;
    }

    public synchronized void invalidate() {
        snapshot = null;
    }

    private Snapshot load() {
        List<PolicyRule> ruleList = rules.findByActiveTrue();
        List<AppSetting> settingList = settings.findAll();
        Set<String> tier1 = new HashSet<>();
        for (CityTier c : cities.findAll()) {
            if (c.getTier() == 1) tier1.add(c.getCity());
        }
        Map<String, String> settingMap = new HashMap<>();
        for (AppSetting s : settingList) settingMap.put(s.getKey(), s.getValue());
        return new Snapshot(Instant.now(), ruleList, settingList, tier1, settingMap);
    }

    public record Snapshot(
            Instant loadedAt,
            List<PolicyRule> rules,
            List<AppSetting> settings,
            Set<String> tier1Cities,
            Map<String, String> settingValues
    ) {
        public BigDecimal money(String key) {
            String v = settingValues.get(key);
            return v == null ? BigDecimal.ZERO : new BigDecimal(v);
        }

        public double doubleValue(String key) {
            String v = settingValues.get(key);
            return v == null ? 0.0 : Double.parseDouble(v);
        }
    }
}
