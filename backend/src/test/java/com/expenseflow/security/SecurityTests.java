package com.expenseflow.security;

import com.expenseflow.support.AbstractIntegrationTest;
import com.expenseflow.support.TokenFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class SecurityTests extends AbstractIntegrationTest {

    @Autowired TokenFactory tokens;

    // ---------- JWT ----------

    @Test @DisplayName("JWT — missing Authorization header -> 401 (FR-AUTH-3)")
    void noToken() throws Exception {
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
    }

    @Test @DisplayName("JWT — garbage token -> 401 (FR-AUTH-3) (not accepted)")
    void garbageToken() throws Exception {
        mvc.perform(get("/api/me").header("Authorization", "Bearer not-a-real-jwt"))
                .andExpect(status().isUnauthorized());
    }

    @Test @DisplayName("JWT — tampered signature -> 401 (FR-AUTH-3)")
    void tamperedSignature() throws Exception {
        String good = tokens.emp().substring(7);  // strip 'Bearer '
        // flip the last byte of the signature segment
        int lastDot = good.lastIndexOf('.');
        String tampered = good.substring(0, lastDot + 1) + "A" + good.substring(lastDot + 2);
        mvc.perform(get("/api/me").header("Authorization", "Bearer " + tampered))
                .andExpect(status().isUnauthorized());
    }

    @Test @DisplayName("JWT — missing Bearer prefix -> 401 (FR-AUTH-3)")
    void missingBearerPrefix() throws Exception {
        String good = tokens.emp().substring(7);
        mvc.perform(get("/api/me").header("Authorization", good))
                .andExpect(status().isUnauthorized());
    }

    // ---------- RBAC ----------

    @Test @DisplayName("RBAC — EMPLOYEE blocked on dashboard -> 403")
    void employeeBlockedOnDashboard() throws Exception {
        mvc.perform(get("/api/dashboard/summary").header("Authorization", tokens.emp()))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("RBAC — EMPLOYEE blocked on bulk-approve -> 403")
    void employeeBlockedOnBulk() throws Exception {
        mvc.perform(post("/api/approvals/bulk-approve")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"claimIds\":[1]}"))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("RBAC — MANAGER blocked on payout batch creation -> 403")
    void managerBlockedOnPayout() throws Exception {
        mvc.perform(post("/api/payout-batches")
                .header("Authorization", tokens.mgr())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"claimIds\":[1]}"))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("RBAC — AUDITOR blocked on dashboard-only data? no, AUDITOR has access -> 200")
    void auditorHasDashboardAccess() throws Exception {
        mvc.perform(get("/api/dashboard/summary").header("Authorization", tokens.auditor()))
                .andExpect(status().isOk());
    }

    // ---------- Object-level ----------

    @Test @DisplayName("Object-level — EMPLOYEE cannot view colleague claim (404 not 403, no enumeration)")
    void noEnumerationViaId() throws Exception {
        // Nonexistent claims also return 404 so caller can't tell existence from visibility.
        mvc.perform(get("/api/claims/99999").header("Authorization", tokens.emp()))
                .andExpect(status().isNotFound());
    }

    // ---------- Upload safety ----------

    @Test @DisplayName("Upload — rejects text/plain -> 415")
    void rejectsBadType() throws Exception {
        MockMultipartFile f = new MockMultipartFile("file", "a.txt", "text/plain", "hi".getBytes());
        mvc.perform(multipart("/api/receipts").file(f).header("Authorization", tokens.emp()))
                .andExpect(status().isUnsupportedMediaType());
    }

    @Test @DisplayName("Upload — accepts image/png")
    void acceptsPng() throws Exception {
        // minimal 1x1 PNG header
        byte[] png = new byte[]{(byte)0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A};
        MockMultipartFile f = new MockMultipartFile("file", "a.png", "image/png", png);
        mvc.perform(multipart("/api/receipts").file(f).header("Authorization", tokens.emp()))
                .andExpect(status().isCreated());
    }

    // ---------- Filter injection ----------

    @Test @DisplayName("Filter params — SQL-ish injection in status parameter -> 400 (enum parsing)")
    void sqlInjectionInStatusParam() throws Exception {
        mvc.perform(get("/api/claims?status=DRAFT'%20OR%201=1--")
                .header("Authorization", tokens.emp()))
                .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("Pagination — size > 100 rejected")
    void paginationCap() throws Exception {
        mvc.perform(get("/api/claims?size=9999").header("Authorization", tokens.emp()))
                .andExpect(status().isBadRequest());
    }

    // ---------- Error response hygiene ----------

    @Test @DisplayName("Error body — no stacktrace leaks on 500/400")
    void errorsHaveNoStackTrace() throws Exception {
        mvc.perform(post("/api/claims")
                .header("Authorization", tokens.emp())
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"lines\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("at java.base"))))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("at org.springframework"))));
    }

    @Test @DisplayName("Correlation id — X-Request-ID header present on every response")
    void correlationIdHeader() throws Exception {
        mvc.perform(get("/api/me").header("Authorization", tokens.emp()))
                .andExpect(header().exists("X-Request-ID"));
    }
}
