package com.expenseflow.security;

import com.expenseflow.filter.JwtAuthFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import com.expenseflow.filter.CorrelationIdFilter;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import java.io.IOException;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthFilter jwtAuthFilter) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(
                                "/actuator/health/**",
                                "/actuator/info",
                                "/actuator/prometheus",
                                "/v3/api-docs/**",
                                "/swagger-ui/**",
                                "/swagger-ui.html",
                                "/api/auth/login"
                        ).permitAll()
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().permitAll()
                )
                .exceptionHandling(e -> e
                        // No/expired token -> 401 so the SPA can send the user back to /login
                        .authenticationEntryPoint((req, res, ex) ->
                                writeProblem(res, 401, "Unauthorized", "Missing or expired token", req.getRequestURI()))
                        .accessDeniedHandler((req, res, ex) ->
                                writeProblem(res, 403, "Forbidden", "You are not allowed to perform this action", req.getRequestURI())))
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private static void writeProblem(HttpServletResponse res, int status, String title, String detail, String instance)
            throws IOException {
        String cid = MDC.get(CorrelationIdFilter.MDC_KEY);
        res.setStatus(status);
        res.setContentType("application/problem+json");
        res.setCharacterEncoding("UTF-8");
        res.getWriter().write("{\"type\":\"about:blank\",\"title\":\"" + title + "\",\"status\":" + status
                + ",\"detail\":\"" + detail + "\",\"instance\":\"" + escape(instance) + "\""
                + (cid == null ? "" : ",\"correlationId\":\"" + escape(cid) + "\"") + ",\"errors\":[]}");
    }

    private static String escape(String v) {
        return v == null ? "" : v.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
