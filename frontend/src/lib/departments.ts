/**
 * Departments known to the seed data. The contract has no departments endpoint,
 * so the register form and the mock share this list. `code` is what the bulk CSV uses.
 */
export const DEPARTMENTS = [
  { id: 1, code: "ENG", name: "Engineering" },
  { id: 2, code: "SALES", name: "Sales" },
  { id: 3, code: "OPS", name: "Operations" },
  { id: 4, code: "MKT", name: "Marketing" },
  { id: 9, code: "FIN", name: "Finance" },
] as const

export const BULK_USER_HEADER = "employee_code,name,email,role,department_code,manager_email,account_number,ifsc"

/** Field rules from CreateUserRequest in the contract. */
export const USER_RULES = {
  employeeCode: /^[A-Za-z0-9_-]{2,32}$/,
  accountNumber: /^[0-9]{9,32}$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
}
