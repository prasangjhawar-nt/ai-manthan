-- V2: Seed policy config, settings, tier-1 cities, departments and the 6 demo users.
-- Passwords: all demo users use "Demo@123" (BCrypt cost 10).

-- ---------- Policy config ----------
INSERT INTO policy_rules (code, category, limit_amount, unit, city_tier, active, description) VALUES
    ('MEAL_DAILY',  'MEALS',     1500.00, 'PER_DAY',   NULL, TRUE, 'Meals up to 1,500 INR per employee per day'),
    ('HOTEL_T1',    'HOTEL',     6000.00, 'PER_NIGHT', 1,    TRUE, 'Hotel up to 6,000 INR per night in tier-1 cities'),
    ('HOTEL_OTHER', 'HOTEL',     4000.00, 'PER_NIGHT', 2,    TRUE, 'Hotel up to 4,000 INR per night in other cities'),
    ('CAB_TRIP',    'LOCAL_CAB', 2000.00, 'PER_TRIP',  NULL, TRUE, 'Local cab up to 2,000 INR per trip');

INSERT INTO app_settings (key, value, description) VALUES
    ('receipt.required.above',     '500',     'Receipt mandatory above this amount'),
    ('auto_approve.max_total',     '5000',    'Max claim total for auto-approval'),
    ('approval.auditor.above',     '25000',   'Auditor step above this total'),
    ('approval.head.above',        '100000',  'Head step above this total'),
    ('sample_audit.rate',          '0.10',    'Share of auto-approved claims sampled'),
    ('alert.oldest_pending.hours', '48',      'Alert threshold for oldest pending approval');

INSERT INTO city_tiers (city, tier) VALUES
    ('Mumbai', 1), ('Delhi', 1), ('Bengaluru', 1), ('Chennai', 1),
    ('Kolkata', 1), ('Hyderabad', 1), ('Pune', 1), ('Ahmedabad', 1);

-- ---------- Departments ----------
INSERT INTO departments (code, name) VALUES
    ('ENG',  'Engineering'),
    ('SAL',  'Sales'),
    ('MKT',  'Marketing'),
    ('FIN',  'Finance'),
    ('HR',   'HR'),
    ('OPS',  'Operations'),
    ('CS',   'Customer Success'),
    ('LEG',  'Legal');

-- ---------- Demo users ----------
-- BCrypt("Demo@123", cost=10) = $2a$10$r69ou9.isQiSOfxae0OLreIvUhz2nzjTTECVkMIUJrYAMzUIJwAOy
-- Insert order: HEAD first (no manager), then AUDITOR, then MANAGERS, then EMPLOYEES.

INSERT INTO employees (employee_code, name, email, password_hash, role, department_id, manager_id, account_number, ifsc, active) VALUES
    ('E0001', 'Meera Krishnan',  'head.demo@expenseflow.test',       '$2a$10$r69ou9.isQiSOfxae0OLreIvUhz2nzjTTECVkMIUJrYAMzUIJwAOy', 'HEAD',     (SELECT id FROM departments WHERE code = 'FIN'), NULL, '100000000001', 'HDFC0000001', TRUE);

INSERT INTO employees (employee_code, name, email, password_hash, role, department_id, manager_id, account_number, ifsc, active) VALUES
    ('E0005', 'Kavya Reddy',     'auditor.demo@expenseflow.test',    '$2a$10$r69ou9.isQiSOfxae0OLreIvUhz2nzjTTECVkMIUJrYAMzUIJwAOy', 'AUDITOR',  (SELECT id FROM departments WHERE code = 'FIN'), (SELECT id FROM employees WHERE email = 'head.demo@expenseflow.test'), '100000000005', 'HDFC0000005', TRUE);

INSERT INTO employees (employee_code, name, email, password_hash, role, department_id, manager_id, account_number, ifsc, active) VALUES
    ('E0021', 'Vikram Nair',     'mgr.demo@expenseflow.test',        '$2a$10$r69ou9.isQiSOfxae0OLreIvUhz2nzjTTECVkMIUJrYAMzUIJwAOy', 'MANAGER',  (SELECT id FROM departments WHERE code = 'ENG'), (SELECT id FROM employees WHERE email = 'head.demo@expenseflow.test'), '100000000021', 'HDFC0000021', TRUE),
    ('E0022', 'Neha Kulkarni',   'mgr.leave@expenseflow.test',       '$2a$10$r69ou9.isQiSOfxae0OLreIvUhz2nzjTTECVkMIUJrYAMzUIJwAOy', 'MANAGER',  (SELECT id FROM departments WHERE code = 'ENG'), (SELECT id FROM employees WHERE email = 'head.demo@expenseflow.test'), '100000000022', 'HDFC0000022', TRUE);

INSERT INTO employees (employee_code, name, email, password_hash, role, department_id, manager_id, account_number, ifsc, active) VALUES
    ('E0101', 'Asha Verma',      'emp.demo@expenseflow.test',        '$2a$10$r69ou9.isQiSOfxae0OLreIvUhz2nzjTTECVkMIUJrYAMzUIJwAOy', 'EMPLOYEE', (SELECT id FROM departments WHERE code = 'ENG'), (SELECT id FROM employees WHERE email = 'mgr.demo@expenseflow.test'),  '100000000101', 'HDFC0000101', TRUE),
    ('E0102', 'Rohan Iyer',      'colleague.demo@expenseflow.test',  '$2a$10$r69ou9.isQiSOfxae0OLreIvUhz2nzjTTECVkMIUJrYAMzUIJwAOy', 'EMPLOYEE', (SELECT id FROM departments WHERE code = 'ENG'), (SELECT id FROM employees WHERE email = 'mgr.demo@expenseflow.test'),  '100000000102', 'HDFC0000102', TRUE);

-- ---------- Delegation: mgr.leave -> mgr.demo, today ± 3 days ----------
INSERT INTO delegations (approver_id, delegate_id, from_date, to_date) VALUES
    (
      (SELECT id FROM employees WHERE email = 'mgr.leave@expenseflow.test'),
      (SELECT id FROM employees WHERE email = 'mgr.demo@expenseflow.test'),
      CURRENT_DATE - INTERVAL '3 days',
      CURRENT_DATE + INTERVAL '3 days'
    );
