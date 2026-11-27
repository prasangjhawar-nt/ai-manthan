package com.expenseflow.controller;

import com.expenseflow.support.AbstractIntegrationTest;
import com.expenseflow.support.TokenFactory;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.LocalDate;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ApprovalControllerTests extends AbstractIntegrationTest {

    @Autowired TokenFactory tokens;

    @Test @DisplayName("POST /approve — manager approves a PENDING_MANAGER claim -> APPROVED under threshold")
    void managerApprovesSmallClaim() throws Exception {
        Long id = createPendingManagerClaim(6000);  // > 5000 triggers routing, < 25000 stays at manager
        mvc.perform(post("/api/claims/" + id + "/approve")
                .header("Authorization", tokens.mgr())
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
    }

    @Test @DisplayName("POST /approve — owner cannot approve own claim -> 403")
    void cannotApproveOwnClaim() throws Exception {
        Long id = createPendingManagerClaim(6000);
        mvc.perform(post("/api/claims/" + id + "/approve")
                .header("Authorization", tokens.emp())
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("POST /approve — auditor cannot act at PENDING_MANAGER level -> 403")
    void auditorBlockedAtManagerLevel() throws Exception {
        Long id = createPendingManagerClaim(6000);
        mvc.perform(post("/api/claims/" + id + "/approve")
                .header("Authorization", tokens.auditor())
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("POST /send-back — comment required (400 if missing)")
    void sendBackRequiresComment() throws Exception {
        Long id = createPendingManagerClaim(6000);
        mvc.perform(post("/api/claims/" + id + "/send-back")
                .header("Authorization", tokens.mgr())
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("POST /send-back — valid comment -> NEEDS_CLARIFICATION")
    void sendBackValid() throws Exception {
        Long id = createPendingManagerClaim(6000);
        mvc.perform(post("/api/claims/" + id + "/send-back")
                .header("Authorization", tokens.mgr())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"comment":"please provide hotel breakdown"}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("NEEDS_CLARIFICATION"));
    }

    @Test @DisplayName("POST /reject — reason required")
    void rejectRequiresReason() throws Exception {
        Long id = createPendingManagerClaim(6000);
        mvc.perform(post("/api/claims/" + id + "/reject")
                .header("Authorization", tokens.mgr())
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("POST /approve — DRAFT claim (invalid state) -> 409")
    void approveDraftClaim() throws Exception {
        Long id = createDraftReturnId();
        mvc.perform(post("/api/claims/" + id + "/approve")
                .header("Authorization", tokens.mgr())
                .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isConflict());
    }

    @Test @DisplayName("POST /approvals/bulk-approve — employee blocked -> 403")
    void bulkApproveAsEmployee() throws Exception {
        mvc.perform(post("/api/approvals/bulk-approve")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"claimIds":[1]}
                        """))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("GET /approvals/queue — MANAGER sees direct-report PENDING_MANAGER claims")
    void managerSeesQueue() throws Exception {
        Long id = createPendingManagerClaim(6000);
        mvc.perform(get("/api/approvals/queue").header("Authorization", tokens.mgr()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == " + id + ")]").exists());
    }

    // ---------- helpers ----------

    private Long createDraftReturnId() throws Exception {
        String body = """
                {"title":"T","lines":[{"category":"MEALS","expenseDate":"%s","amount":400,"vendor":"V"}]}
                """.formatted(LocalDate.now().minusDays(1));
        MvcResult r = mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andReturn();
        return Long.valueOf(JsonPath.read(r.getResponse().getContentAsString(), "$.id").toString());
    }

    /** Creates a claim at amount X, uploads a receipt (R4 requires it above 500), submits -> PENDING_MANAGER. */
    private Long createPendingManagerClaim(int amount) throws Exception {
        // Upload a receipt
        byte[] fake = "%PDF-1.4\n...".getBytes();
        MockMultipartFile f = new MockMultipartFile("file", "r.pdf", "application/pdf", fake);
        MvcResult up = mvc.perform(multipart("/api/receipts").file(f)
                .header("Authorization", tokens.emp()))
                .andExpect(status().isCreated())
                .andReturn();
        Long receiptId = Long.valueOf(JsonPath.read(up.getResponse().getContentAsString(), "$.id").toString());

        // Draft referencing the receipt (FLIGHT -> NO_POLICY so it routes to PENDING_MANAGER)
        String body = """
                {"title":"T","lines":[{"category":"FLIGHT","expenseDate":"%s","amount":%d,"vendor":"IndiGo","receiptId":%d}]}
                """.formatted(LocalDate.now().minusDays(1), amount, receiptId);
        MvcResult cr = mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andReturn();
        Long id = Long.valueOf(JsonPath.read(cr.getResponse().getContentAsString(), "$.id").toString());

        mvc.perform(post("/api/claims/" + id + "/submit")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING_MANAGER"));
        return id;
    }
}
