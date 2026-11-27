package com.expenseflow.model;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "policy_rules")
public class PolicyRule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 32)
    private String code;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Category category;

    @Column(name = "limit_amount", nullable = false, precision = 12, scale = 2)
    private BigDecimal limitAmount;

    @Column(nullable = false, length = 32)
    private String unit;

    @Column(name = "city_tier")
    private Short cityTier;

    @Column(nullable = false)
    private boolean active = true;

    @Column(length = 255)
    private String description;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getCode() { return code; }
    public void setCode(String code) { this.code = code; }

    public Category getCategory() { return category; }
    public void setCategory(Category category) { this.category = category; }

    public BigDecimal getLimitAmount() { return limitAmount; }
    public void setLimitAmount(BigDecimal limitAmount) { this.limitAmount = limitAmount; }

    public String getUnit() { return unit; }
    public void setUnit(String unit) { this.unit = unit; }

    public Short getCityTier() { return cityTier; }
    public void setCityTier(Short cityTier) { this.cityTier = cityTier; }

    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
}
