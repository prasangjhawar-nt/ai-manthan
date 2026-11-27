package com.expenseflow.controller;

import com.expenseflow.support.AbstractIntegrationTest;
import com.expenseflow.support.TokenFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AuthControllerTests extends AbstractIntegrationTest {

    @Autowired TokenFactory tokens;

    @Test @DisplayName("POST /api/auth/login — valid credentials -> 200 with JWT")
    void loginOk() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"email":"emp.demo@expenseflow.test","password":"Demo@123"}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.user.role").value("EMPLOYEE"))
                .andExpect(jsonPath("$.user.email").value("emp.demo@expenseflow.test"));
    }

    @Test @DisplayName("POST /api/auth/login — bad password -> 401")
    void loginBadPassword() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"email":"emp.demo@expenseflow.test","password":"wrong"}
                        """))
                .andExpect(status().isUnauthorized());
    }

    @Test @DisplayName("POST /api/auth/login — unknown email -> 401 (not 404, avoid enumeration)")
    void loginUnknownEmail() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"email":"nobody@expenseflow.test","password":"Demo@123"}
                        """))
                .andExpect(status().isUnauthorized());
    }

    @Test @DisplayName("POST /api/auth/login — invalid email format -> 400")
    void loginInvalidEmail() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"email":"not-an-email","password":"Demo@123"}
                        """))
                .andExpect(status().isBadRequest());
    }

    @Test @DisplayName("GET /api/me without token -> 403 (chain blocks the request)")
    void meNoToken() throws Exception {
        mvc.perform(get("/api/me"))
                .andExpect(status().isForbidden());
    }

    @Test @DisplayName("GET /api/me with valid token -> 200 profile")
    void meOk() throws Exception {
        mvc.perform(get("/api/me").header("Authorization", tokens.emp()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("emp.demo@expenseflow.test"))
                .andExpect(jsonPath("$.departmentName").value("Engineering"));
    }
}
