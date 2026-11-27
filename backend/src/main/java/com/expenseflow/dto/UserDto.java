package com.expenseflow.dto;

import com.expenseflow.model.Employee;
import com.expenseflow.model.Role;

public record UserDto(
        Long id,
        String employeeCode,
        String name,
        String email,
        Role role,
        Long departmentId,
        String departmentName,
        Long managerId
) {
    public static UserDto from(Employee e) {
        return new UserDto(
                e.getId(),
                e.getEmployeeCode(),
                e.getName(),
                e.getEmail(),
                e.getRole(),
                e.getDepartment().getId(),
                e.getDepartment().getName(),
                e.getManager() == null ? null : e.getManager().getId()
        );
    }
}
