package com.expenseflow.service;

import com.expenseflow.dto.LoginRequest;
import com.expenseflow.dto.LoginResponse;
import com.expenseflow.dto.UserDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Employee;
import com.expenseflow.repository.EmployeeRepository;
import com.expenseflow.security.JwtService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

@Service
public class AuthService {

    private final EmployeeRepository employees;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final AuditService audit;

    public AuthService(EmployeeRepository employees, PasswordEncoder encoder,
                       JwtService jwt, AuditService audit) {
        this.employees = employees;
        this.encoder = encoder;
        this.jwt = jwt;
        this.audit = audit;
    }

    @Transactional
    public LoginResponse login(LoginRequest req) {
        Employee user = employees.findActiveByEmailWithDepartment(req.email())
                .orElseThrow(() -> ApiException.unauthorized("Invalid email or password"));
        if (!encoder.matches(req.password(), user.getPasswordHash())) {
            throw ApiException.unauthorized("Invalid email or password");
        }
        String token = jwt.issue(user);
        audit.record(AuditService.Action.LOGIN, AuditService.EntityType.USER,
                user.getId(), null, user, null, null, null,
                Map.of("email", user.getEmail()));
        return new LoginResponse(token, "Bearer", jwt.ttlSeconds(), UserDto.from(user));
    }
}
