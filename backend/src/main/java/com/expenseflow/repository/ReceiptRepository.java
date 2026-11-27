package com.expenseflow.repository;

import com.expenseflow.model.Receipt;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ReceiptRepository extends JpaRepository<Receipt, Long> {
    Optional<Receipt> findFirstBySha256OrderByIdAsc(String sha256);
}
