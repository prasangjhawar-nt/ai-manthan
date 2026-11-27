package com.expenseflow.controller;

import com.expenseflow.support.AbstractIntegrationTest;
import com.expenseflow.support.TokenFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PayoutControllerTests extends AbstractIntegrationTest {

    @Autowired TokenFactory tokens;

    @Test @DisplayName("GET /payout/eligible — employee forbidden -> 403")
    void eligibleAsEmployee() throws Exception {
        mvc.perform(get("/api/payout/eligible").header("Authorization", tokens.emp()))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("GET /payout-batches — head can list even when empty -> 200")
    void listAsHead() throws Exception {
        mvc.perform(get("/api/payout-batches").header("Authorization", tokens.head()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }

    @Test @DisplayName("POST /payout-batches — employee forbidden -> 403")
    void createAsEmployee() throws Exception {
        mvc.perform(post("/api/payout-batches")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"claimIds":[1]}
                        """))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("POST /payout-batches — non-existent claim -> 400 or 409")
    void createBogusIds() throws Exception {
        mvc.perform(post("/api/payout-batches")
                .header("Authorization", tokens.head())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"claimIds":[9999]}
                        """))
                .andExpect(result -> {
                    int s = result.getResponse().getStatus();
                    if (s != 400 && s != 409) throw new AssertionError("expected 400 or 409, got " + s);
                });
    }
}
