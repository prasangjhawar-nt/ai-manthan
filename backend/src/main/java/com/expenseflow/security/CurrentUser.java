package com.expenseflow.security;

import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Employee;
import com.expenseflow.model.Role;
import com.expenseflow.repository.EmployeeRepository;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

@Component
public class CurrentUser {

    private final EmployeeRepository employeeRepository;

    public CurrentUser(EmployeeRepository employeeRepository) {
        this.employeeRepository = employeeRepository;
    }

    public Long id() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getPrincipal() == null || "anonymousUser".equals(auth.getPrincipal())) {
            throw ApiException.unauthorized("No authenticated user");
        }
        try {
            return Long.valueOf(auth.getName());
        } catch (NumberFormatException e) {
            throw ApiException.unauthorized("Invalid principal");
        }
    }

    public Employee employee() {
        return employeeRepository.findByIdWithDepartment(id())
                .orElseThrow(() -> ApiException.unauthorized("User not found"));
    }

    public Role role() {
        return employee().getRole();
    }
}
