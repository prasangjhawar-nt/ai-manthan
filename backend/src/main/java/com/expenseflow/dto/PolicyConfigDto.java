package com.expenseflow.dto;

import java.math.BigDecimal;
import java.util.List;

public record PolicyConfigDto(
        List<RuleDto> rules,
        List<SettingDto> settings,
        List<String> tier1Cities
) {
    public record RuleDto(Long id, String code, String category, BigDecimal limitAmount,
                          String unit, Integer cityTier, boolean active, String description) {}
    public record SettingDto(String key, String value, String description) {}
}
