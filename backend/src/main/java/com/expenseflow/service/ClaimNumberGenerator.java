package com.expenseflow.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.ZoneOffset;

@Service
public class ClaimNumberGenerator {

    @PersistenceContext
    private EntityManager em;

    /** EXP-YYYY-NNNNNN using the claim_number_seq Postgres sequence. */
    public String next() {
        Number n = (Number) em.createNativeQuery("SELECT nextval('claim_number_seq')").getSingleResult();
        int year = LocalDate.now(ZoneOffset.UTC).getYear();
        return String.format("EXP-%04d-%06d", year, n.longValue());
    }

    public String nextBatchRef() {
        Number n = (Number) em.createNativeQuery("SELECT nextval('payout_batch_seq')").getSingleResult();
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        return String.format("PB-%04d%02d%02d-%03d",
                today.getYear(), today.getMonthValue(), today.getDayOfMonth(), n.longValue());
    }
}
