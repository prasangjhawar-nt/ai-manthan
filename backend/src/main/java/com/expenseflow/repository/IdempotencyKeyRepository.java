package com.expenseflow.repository;

import com.expenseflow.model.IdempotencyKey;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface IdempotencyKeyRepository extends JpaRepository<IdempotencyKey, Long> {
    Optional<IdempotencyKey> findByIdemKeyAndUserId(String idemKey, Long userId);
}
