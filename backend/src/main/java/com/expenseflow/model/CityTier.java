package com.expenseflow.model;

import jakarta.persistence.*;

@Entity
@Table(name = "city_tiers")
public class CityTier {

    @Id
    @Column(length = 64)
    private String city;

    @Column(nullable = false)
    private short tier;

    public String getCity() { return city; }
    public void setCity(String city) { this.city = city; }

    public short getTier() { return tier; }
    public void setTier(short tier) { this.tier = tier; }
}
