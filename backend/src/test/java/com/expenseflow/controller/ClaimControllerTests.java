package com.expenseflow.controller;

import com.expenseflow.support.AbstractIntegrationTest;
import com.expenseflow.support.TokenFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.LocalDate;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ClaimControllerTests extends AbstractIntegrationTest {

    @Autowired TokenFactory tokens;

    private String draftBody(String amount) {
        return """
                {
                  "title": "Test claim",
                  "lines": [{
                    "category": "MEALS",
                    "expenseDate": "%s",
                    "amount": %s,
                    "vendor": "Cafe"
                  }]
                }
                """.formatted(LocalDate.now().minusDays(1), amount);
    }

    @Test @DisplayName("POST /api/claims — creates DRAFT 201")
    void create() throws Exception {
        mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("400")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.claimNumber", org.hamcrest.Matchers.matchesPattern("^EXP-\\d{4}-\\d{6}$")))
                .andExpect(jsonPath("$.totalAmount").value(400));
    }

    @Test @DisplayName("POST /api/claims — missing Idempotency-Key -> 400")
    void createNoIdempotencyKey() throws Exception {
        mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("400")))
                .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("POST /api/claims — idempotent replay returns same claim")
    void createIdempotentReplay() throws Exception {
        String key = UUID.randomUUID().toString();
        MvcResult first = mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("400")))
                .andExpect(status().isCreated())
                .andReturn();

        MvcResult replay = mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("400")))
                .andExpect(status().isCreated())
                .andReturn();

        // Same claimNumber proves no second row was created.
        String a = first.getResponse().getContentAsString();
        String b = replay.getResponse().getContentAsString();
        org.assertj.core.api.Assertions.assertThat(a).isEqualTo(b);
    }

    @Test @DisplayName("POST /api/claims — same key, different body -> 409")
    void createSameKeyDifferentBody() throws Exception {
        String key = UUID.randomUUID().toString();
        mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("400")))
                .andExpect(status().isCreated());

        mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("450")))
                .andExpect(status().isConflict());
    }

    @Test @DisplayName("POST /api/claims — no lines -> 400 (validation)")
    void createNoLines() throws Exception {
        mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"title":"X","lines":[]}
                        """))
                .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("POST /api/claims — negative amount -> 400")
    void createNegativeAmount() throws Exception {
        mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("-5")))
                .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("POST /api/claims — amount above 10,00,000 -> 400")
    void createOverCap() throws Exception {
        mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("1000001")))
                .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("GET /api/claims/{id} — colleague cannot view -> 404 (not 403)")
    void getClaimAsColleagueIs404() throws Exception {
        Long id = createDraftAndReturnId();
        mvc.perform(get("/api/claims/" + id).header("Authorization", tokens.colleague()))
                .andExpect(status().isNotFound());
    }

    @Test @DisplayName("GET /api/claims/{id} — nonexistent -> 404")
    void getClaimMissing() throws Exception {
        mvc.perform(get("/api/claims/99999").header("Authorization", tokens.emp()))
                .andExpect(status().isNotFound());
    }

    @Test @DisplayName("PUT /api/claims/{id} — stale version -> 409")
    void updateStaleVersion() throws Exception {
        Long id = createDraftAndReturnId();
        mvc.perform(put("/api/claims/" + id)
                .header("Authorization", tokens.emp())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"version":99,"title":"X","lines":[{"category":"MEALS","expenseDate":"%s","amount":100,"vendor":"V"}]}
                        """.formatted(LocalDate.now().minusDays(1))))
                .andExpect(status().isConflict());
    }

    @Test @DisplayName("POST /api/claims/{id}/submit — auto-approves claim ≤ 5000, all clean")
    void submitAutoApprove() throws Exception {
        Long id = createDraftAndReturnId();
        mvc.perform(post("/api/claims/" + id + "/submit")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.lines[0].outcome").value("AUTO_APPROVE"));
    }

    private Long createDraftAndReturnId() throws Exception {
        MvcResult r = mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(draftBody("400")))
                .andReturn();
        return Long.valueOf(com.jayway.jsonpath.JsonPath.read(r.getResponse().getContentAsString(), "$.id").toString());
    }
}
