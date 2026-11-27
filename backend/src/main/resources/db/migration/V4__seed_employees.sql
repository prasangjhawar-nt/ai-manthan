-- V4: the rest of the 150 synthetic employees (README sec 11). V2 already has 6 demo users.
-- Target: 1 HEAD, 3 AUDITOR, 16 MANAGER (2 per department), 130 EMPLOYEE.
-- All passwords "Demo@123": reuse the demo users' BCrypt hash (Spring BCrypt-compatible).
-- Deterministic (setseed) so every reset produces the same people.

SELECT setseed(0.45);

DO $$
DECLARE
    first_names TEXT[] := ARRAY['Aarav','Vivaan','Aditya','Arjun','Sai','Reyansh','Krishna','Ishaan','Rohit','Karan',
                                'Ananya','Diya','Priya','Isha','Kavya','Meera','Riya','Sneha','Pooja','Nisha',
                                'Rahul','Siddharth','Varun','Nikhil','Amit','Deepa','Lakshmi','Shreya','Tanvi','Aditi'];
    last_names  TEXT[] := ARRAY['Sharma','Verma','Patel','Reddy','Nair','Iyer','Gupta','Mehta','Joshi','Kulkarni',
                                'Rao','Menon','Das','Bose','Singh','Chopra','Malhotra','Kapoor','Pillai','Shetty'];
    pwd        TEXT;
    head_id    BIGINT;
    dept       RECORD;
    seq        INT := 0;    -- running number for unique emails
    code_no    INT;
    fn         TEXT;
    ln         TEXT;
    mgr_ids    BIGINT[];
    i          INT;
BEGIN
    SELECT password_hash INTO pwd    FROM employees WHERE email = 'head.demo@expenseflow.test';
    SELECT id            INTO head_id FROM employees WHERE email = 'head.demo@expenseflow.test';

    -- 2 more auditors (Finance), report to the head
    FOR i IN 2..3 LOOP
        seq := seq + 1;
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        INSERT INTO employees (employee_code, name, email, password_hash, role, department_id, manager_id, account_number, ifsc)
        VALUES (format('E%s', lpad(i::text, 4, '0')), fn || ' ' || ln,
                lower(format('%s.%s.%s@expenseflow.test', fn, ln, seq)), pwd, 'AUDITOR',
                (SELECT id FROM departments WHERE code = 'FIN'), head_id,
                lpad((floor(random() * 1e12))::bigint::text, 12, '0'),
                'HDFC' || lpad((floor(random() * 1e7))::int::text, 7, '0'));
    END LOOP;

    -- 2 managers per department (ENG already has mgr.demo + mgr.leave), report to the head
    code_no := 23;
    FOR dept IN SELECT id, code FROM departments WHERE code <> 'ENG' ORDER BY id LOOP
        FOR i IN 1..2 LOOP
            seq := seq + 1;
            fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
            ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
            INSERT INTO employees (employee_code, name, email, password_hash, role, department_id, manager_id, account_number, ifsc)
            VALUES (format('E%s', lpad(code_no::text, 4, '0')), fn || ' ' || ln,
                    lower(format('%s.%s.%s@expenseflow.test', fn, ln, seq)), pwd, 'MANAGER', dept.id, head_id,
                    lpad((floor(random() * 1e12))::bigint::text, 12, '0'),
                    'ICIC' || lpad((floor(random() * 1e7))::int::text, 7, '0'));
            code_no := code_no + 1;
        END LOOP;
    END LOOP;

    -- 128 more employees (130 with the 2 demo employees), 16 per department, alternating between its 2 managers
    code_no := 103;
    FOR i IN 1..128 LOOP
        SELECT d.id, d.code INTO dept FROM departments d ORDER BY d.id OFFSET ((i - 1) % 8) LIMIT 1;
        SELECT array_agg(e.id ORDER BY e.id) INTO mgr_ids
          FROM employees e WHERE e.role = 'MANAGER' AND e.department_id = dept.id;
        seq := seq + 1;
        fn := first_names[1 + floor(random() * array_length(first_names, 1))::int];
        ln := last_names[1 + floor(random() * array_length(last_names, 1))::int];
        INSERT INTO employees (employee_code, name, email, password_hash, role, department_id, manager_id, account_number, ifsc)
        VALUES (format('E%s', lpad(code_no::text, 4, '0')), fn || ' ' || ln,
                lower(format('%s.%s.%s@expenseflow.test', fn, ln, seq)), pwd, 'EMPLOYEE', dept.id,
                mgr_ids[1 + (i / 8) % 2],
                lpad((floor(random() * 1e12))::bigint::text, 12, '0'),
                'SBIN' || lpad((floor(random() * 1e7))::int::text, 7, '0'));
        code_no := code_no + 1;
    END LOOP;
END $$;
