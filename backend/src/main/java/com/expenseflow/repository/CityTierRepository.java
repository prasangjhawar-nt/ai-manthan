package com.expenseflow.repository;

import com.expenseflow.model.CityTier;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CityTierRepository extends JpaRepository<CityTier, String> {
}
