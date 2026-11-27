package com.expenseflow.support;

import com.expenseflow.repository.EmployeeRepository;
import com.expenseflow.security.JwtService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Issues a JWT for a seeded demo email. */
@Component
public class TokenFactory {

    @Autowired EmployeeRepository employees;
    @Autowired JwtService jwt;

    public String tokenFor(String email) {
        var user = employees.findActiveByEmailWithDepartment(email)
                .orElseThrow(() -> new IllegalStateException("seed user missing: " + email));
        return jwt.issue(user);
    }

    public String bearer(String email) {
        return "Bearer " + tokenFor(email);
    }

    public String emp()      { return bearer("emp.demo@expenseflow.test"); }
    public String colleague(){ return bearer("colleague.demo@expenseflow.test"); }
    public String mgr()      { return bearer("mgr.demo@expenseflow.test"); }
    public String auditor()  { return bearer("auditor.demo@expenseflow.test"); }
    public String head()     { return bearer("head.demo@expenseflow.test"); }
}
