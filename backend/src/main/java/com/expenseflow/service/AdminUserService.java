package com.expenseflow.service;

import com.expenseflow.dto.BulkUserResponse;
import com.expenseflow.dto.CreateUserRequest;
import com.expenseflow.dto.CreateUserResponse;
import com.expenseflow.dto.UserDto;
import com.expenseflow.exception.ApiException;
import com.expenseflow.model.Department;
import com.expenseflow.model.Employee;
import com.expenseflow.model.Role;
import com.expenseflow.repository.DepartmentRepository;
import com.expenseflow.repository.EmployeeRepository;
import com.expenseflow.security.CurrentUser;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class AdminUserService {

    private static final SecureRandom RNG = new SecureRandom();
    private static final char[] PWD_ALPHABET =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$%".toCharArray();
    private static final int PWD_LENGTH = 16;

    private final EmployeeRepository employees;
    private final DepartmentRepository departments;
    private final PasswordEncoder encoder;
    private final CurrentUser current;
    private final AuditService audit;

    public AdminUserService(EmployeeRepository employees, DepartmentRepository departments,
                            PasswordEncoder encoder, CurrentUser current, AuditService audit) {
        this.employees = employees;
        this.departments = departments;
        this.encoder = encoder;
        this.current = current;
        this.audit = audit;
    }

    /** Only HEAD can provision users. */
    private void assertHead() {
        if (current.role() != Role.HEAD) {
            throw ApiException.forbidden("Only HEAD can provision users");
        }
    }

    @Transactional
    public CreateUserResponse create(CreateUserRequest req) {
        assertHead();
        return createOne(req);
    }

    @Transactional
    public BulkUserResponse bulkCreate(MultipartFile file) {
        assertHead();
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("CSV file is required");
        }
        List<BulkUserResponse.Result> results = new ArrayList<>();
        int succeeded = 0, failed = 0;

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8))) {
            String header = reader.readLine();
            if (header == null) {
                throw ApiException.badRequest("CSV is empty");
            }
            Map<String, Integer> col = parseHeader(header);
            // Required columns
            for (String c : List.of("employee_code", "name", "email", "role",
                    "department_code", "manager_email", "account_number", "ifsc")) {
                if (!col.containsKey(c)) {
                    throw ApiException.badRequest("CSV missing required column: " + c);
                }
            }

            String line;
            int rowNo = 1;
            while ((line = reader.readLine()) != null) {
                rowNo++;
                if (line.isBlank()) continue;
                String[] cells = splitCsv(line);
                try {
                    CreateUserRequest req = toRequest(cells, col);
                    CreateUserResponse one = createOne(req);
                    results.add(new BulkUserResponse.Result(
                            rowNo,
                            one.user().employeeCode(),
                            one.user().email(),
                            "CREATED",
                            one.user().id(),
                            one.temporaryPassword(),
                            null, null));
                    succeeded++;
                } catch (ApiException e) {
                    results.add(new BulkUserResponse.Result(
                            rowNo,
                            safe(cells, col.get("employee_code")),
                            safe(cells, col.get("email")),
                            "SKIPPED",
                            null, null,
                            e.status().value(), e.getMessage()));
                    failed++;
                }
            }
        } catch (IOException e) {
            throw ApiException.badRequest("Could not read CSV: " + e.getMessage());
        }
        return new BulkUserResponse(succeeded + failed, succeeded, failed, results);
    }

    // ---------- shared create path ----------

    private CreateUserResponse createOne(CreateUserRequest req) {
        if (req.role() == Role.EMPLOYEE && req.managerId() == null) {
            // employees must have a manager; managers/auditors/head may be null
            throw ApiException.badRequest("EMPLOYEE requires a managerId");
        }
        employees.findActiveByEmailWithDepartment(req.email()).ifPresent(e -> {
            throw ApiException.conflict("Email already in use");
        });
        Department dept = departments.findById(req.departmentId())
                .orElseThrow(() -> ApiException.badRequest("Department not found: " + req.departmentId()));
        Employee manager = null;
        if (req.managerId() != null) {
            manager = employees.findById(req.managerId())
                    .orElseThrow(() -> ApiException.badRequest("Manager not found: " + req.managerId()));
        }
        String tempPassword = generatePassword();
        Employee e = new Employee();
        e.setEmployeeCode(req.employeeCode());
        e.setName(req.name());
        e.setEmail(req.email());
        e.setPasswordHash(encoder.encode(tempPassword));
        e.setRole(req.role());
        e.setDepartment(dept);
        e.setManager(manager);
        e.setAccountNumber(req.accountNumber());
        e.setIfsc(req.ifsc());
        e.setActive(true);
        Employee saved = employees.save(e);

        audit.record(AuditService.Action.USER_CREATED,
                AuditService.EntityType.USER,
                saved.getId(), null,
                current.employee(), null, null, null,
                Map.of("email", saved.getEmail(),
                        "role",  saved.getRole().name(),
                        "departmentId", dept.getId()));

        return new CreateUserResponse(UserDto.from(saved), tempPassword);
    }

    private static String generatePassword() {
        StringBuilder sb = new StringBuilder(PWD_LENGTH);
        for (int i = 0; i < PWD_LENGTH; i++) {
            sb.append(PWD_ALPHABET[RNG.nextInt(PWD_ALPHABET.length)]);
        }
        return sb.toString();
    }

    // ---------- CSV helpers ----------

    private static Map<String, Integer> parseHeader(String header) {
        String[] cells = splitCsv(header);
        Map<String, Integer> map = new HashMap<>();
        for (int i = 0; i < cells.length; i++) {
            map.put(cells[i].trim().toLowerCase(), i);
        }
        return map;
    }

    private CreateUserRequest toRequest(String[] cells, Map<String, Integer> col) {
        String roleStr = get(cells, col, "role");
        Role role;
        try {
            role = Role.valueOf(roleStr);
        } catch (IllegalArgumentException ex) {
            throw ApiException.badRequest("Invalid role: " + roleStr);
        }
        String deptCode = get(cells, col, "department_code");
        Long deptId = departments.findByCode(deptCode)
                .orElseThrow(() -> ApiException.badRequest("Department code not found: " + deptCode))
                .getId();
        String managerEmail = safe(cells, col.get("manager_email"));
        Long managerId = null;
        if (managerEmail != null && !managerEmail.isBlank()) {
            managerId = employees.findActiveByEmailWithDepartment(managerEmail.trim())
                    .orElseThrow(() -> ApiException.badRequest("Manager email not found: " + managerEmail))
                    .getId();
        }
        return new CreateUserRequest(
                get(cells, col, "employee_code"),
                get(cells, col, "name"),
                get(cells, col, "email"),
                role,
                deptId,
                managerId,
                get(cells, col, "account_number"),
                get(cells, col, "ifsc")
        );
    }

    private static String get(String[] cells, Map<String, Integer> col, String key) {
        Integer idx = col.get(key);
        if (idx == null || idx >= cells.length) {
            throw ApiException.badRequest("Missing value for " + key);
        }
        String v = cells[idx].trim();
        if (v.isEmpty()) throw ApiException.badRequest("Empty value for " + key);
        return v;
    }

    private static String safe(String[] cells, Integer idx) {
        if (idx == null || idx >= cells.length) return null;
        String v = cells[idx].trim();
        return v.isEmpty() ? null : v;
    }

    /** Minimal RFC 4180 CSV split: supports commas inside double quotes and "" escapes.
     *  Good enough for HR-authored sheets exported from Excel. */
    private static String[] splitCsv(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') { cur.append('"'); i++; }
                    else inQuotes = false;
                } else cur.append(c);
            } else {
                if (c == ',') { out.add(cur.toString()); cur.setLength(0); }
                else if (c == '"') inQuotes = true;
                else cur.append(c);
            }
        }
        out.add(cur.toString());
        return out.toArray(new String[0]);
    }
}
