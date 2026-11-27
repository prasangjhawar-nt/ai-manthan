/** Register employee (ST-13): POST /api/admin/users and /api/admin/users/bulk. */
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { renderApp, renderAt, signIn } from "@/test/render"
import { Api } from "@/api/endpoints"
import { ApiError } from "@/api/client"
import { BULK_USER_HEADER } from "@/lib/departments"
import RegisterUserPage from "./RegisterUserPage"

const routes = [{ path: "/admin/users", element: <RegisterUserPage /> }]
const uniq = () => Math.random().toString(36).slice(2, 7)

describe("Register employee (ST-13)", () => {
  it("is finance-head only: an employee is redirected away", async () => {
    await signIn()
    await renderApp("/admin/users")
    expect(await screen.findByRole("heading", { level: 1, name: "My claims" })).toBeInTheDocument()
  })

  it("validates fields before calling the API, incl. manager for employees", async () => {
    await signIn("head.demo@expenseflow.test")
    const { user } = renderAt("/admin/users", routes)
    await user.type(screen.getByTestId("reg-ifsc"), "bad")
    await user.click(screen.getByTestId("register-submit"))
    expect(await screen.findByText("Enter the employee's full name")).toBeInTheDocument()
    expect(screen.getByText("2–32 letters, digits, _ or -")).toBeInTheDocument()
    expect(screen.getByText("Employees need a manager")).toBeInTheDocument()
    expect(screen.getByText("9–32 digits, no spaces")).toBeInTheDocument()
    expect(screen.getByText("11 characters, like HDFC0001234")).toBeInTheDocument()
  })

  it("registers an employee, shows the one-time password, and the new user can sign in", async () => {
    await signIn("head.demo@expenseflow.test")
    const { user } = renderAt("/admin/users", routes)
    const id = uniq()
    const email = `new.${id}@expenseflow.test`
    await user.type(screen.getByTestId("reg-name"), "Nitin Chopra")
    await user.type(screen.getByTestId("reg-code"), `E${id}`)
    await user.type(screen.getByTestId("reg-email"), email)
    await user.selectOptions(screen.getByTestId("reg-dept"), "2")
    await user.type(screen.getByTestId("reg-manager"), "34")
    await user.type(screen.getByTestId("reg-account"), "100000000211")
    await user.type(screen.getByTestId("reg-ifsc"), "icic0000211")
    await user.click(screen.getByTestId("register-submit"))

    const result = await screen.findByTestId("register-result")
    expect(within(result).getByText("Nitin Chopra")).toBeInTheDocument()
    const pw = screen.getByTestId("temp-password").getAttribute("data-value")!
    expect(pw).toHaveLength(16)
    expect(screen.getByTestId("temp-password")).not.toHaveTextContent(pw) // masked by default

    const login = await Api.login(email, pw)
    expect(login.user).toMatchObject({ role: "EMPLOYEE", departmentName: "Sales", managerId: 34 })
  })

  it("shows a 409 on a duplicate email against the field", async () => {
    await signIn("head.demo@expenseflow.test")
    const { user } = renderAt("/admin/users", routes)
    await user.type(screen.getByTestId("reg-name"), "Dup Person")
    await user.type(screen.getByTestId("reg-code"), `E${uniq()}`)
    await user.type(screen.getByTestId("reg-email"), "emp.demo@expenseflow.test")
    await user.selectOptions(screen.getByTestId("reg-dept"), "1")
    await user.type(screen.getByTestId("reg-manager"), "21")
    await user.type(screen.getByTestId("reg-account"), "100000000999")
    await user.type(screen.getByTestId("reg-ifsc"), "HDFC0001234")
    await user.click(screen.getByTestId("register-submit"))
    expect(await screen.findByText("Email already in use")).toBeInTheDocument()
  })

  it("bulk CSV: each row is processed independently", async () => {
    await signIn("head.demo@expenseflow.test")
    const { user } = renderAt("/admin/users", routes)
    await user.click(screen.getByRole("tab", { name: "Bulk CSV" }))
    const a = uniq()
    const csv = [
      BULK_USER_HEADER,
      `B${a}1,Priya Das,priya.${a}@expenseflow.test,EMPLOYEE,ENG,mgr.demo@expenseflow.test,100000000212,HDFC0001234`,
      `B${a}2,Tanvi K,emp.demo@expenseflow.test,EMPLOYEE,ENG,mgr.demo@expenseflow.test,100000000213,HDFC0001234`,
      `B${a}3,Raj N,raj.${a}@expenseflow.test,MANAGER,NOPE,,100000000214,HDFC0001234`,
    ].join("\n")
    await user.upload(screen.getByTestId("bulk-file"), new File([csv], "people.csv", { type: "text/csv" }))
    await user.click(screen.getByTestId("bulk-submit"))
    const res = await screen.findByTestId("bulk-result")
    expect(within(res).getByText("3 rows · 1 registered · 2 skipped")).toBeInTheDocument()
    expect(within(res).getByText("Email already in use")).toBeInTheDocument()
    expect(within(res).getByText(/Unknown department_code/)).toBeInTheDocument()
  })

  it("API rejects non-HEAD callers with 403", async () => {
    await signIn("auditor.demo@expenseflow.test")
    await expect(Api.createUser({ employeeCode: "X1", name: "Xy", email: "x@y.test", role: "EMPLOYEE", departmentId: 1, managerId: 21, accountNumber: "123456789", ifsc: "HDFC0001234" })).rejects.toBeInstanceOf(ApiError)
  })
})
