package com.expenseflow.repository;

import com.expenseflow.model.Employee;
import com.expenseflow.model.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface EmployeeRepository extends JpaRepository<Employee, Long> {

    @Query("select e from Employee e join fetch e.department left join fetch e.manager where e.email = :email and e.active = true")
    Optional<Employee> findActiveByEmailWithDepartment(String email);

    @Query("select e from Employee e join fetch e.department left join fetch e.manager where e.id = :id")
    Optional<Employee> findByIdWithDepartment(Long id);

    List<Employee> findByRoleAndActiveTrue(Role role);

    List<Employee> findByManagerIdAndActiveTrue(Long managerId);
}
