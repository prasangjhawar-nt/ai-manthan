package com.expenseflow.controller;

import com.expenseflow.dto.PolicyConfigDto;
import com.expenseflow.model.AppSetting;
import com.expenseflow.model.PolicyRule;
import com.expenseflow.service.PolicyConfigCache;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/policy-rules")
public class PolicyController {

    private final PolicyConfigCache cache;

    public PolicyController(PolicyConfigCache cache) {
        this.cache = cache;
    }

    @GetMapping
    public PolicyConfigDto get() {
        PolicyConfigCache.Snapshot snap = cache.get();
        List<PolicyConfigDto.RuleDto> rules = new ArrayList<>();
        for (PolicyRule r : snap.rules()) {
            rules.add(new PolicyConfigDto.RuleDto(
                    r.getId(), r.getCode(), r.getCategory().name(), r.getLimitAmount(),
                    r.getUnit(), r.getCityTier() == null ? null : (int) r.getCityTier(),
                    r.isActive(), r.getDescription()));
        }
        List<PolicyConfigDto.SettingDto> settings = new ArrayList<>();
        for (AppSetting s : snap.settings()) {
            settings.add(new PolicyConfigDto.SettingDto(s.getKey(), s.getValue(), s.getDescription()));
        }
        return new PolicyConfigDto(rules, settings, new ArrayList<>(snap.tier1Cities()));
    }
}
