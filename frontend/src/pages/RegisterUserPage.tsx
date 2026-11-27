import { useRef, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, Copy, Download, Eye, EyeOff, FileSpreadsheet, KeyRound, Upload, UserPlus, X } from "lucide-react"
import { Api } from "@/api/endpoints"
import { ApiError } from "@/api/client"
import { toastError } from "@/api/hooks"
import type { BulkUserResponse, CreateUserRequest, CreateUserResponse, Role } from "@/api/types"
import { HeaderActions } from "@/components/layout/AppShell"
import { EmptyState, PageHeader, Segmented } from "@/components/ds/domain"
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, Select } from "@/components/ds/primitives"
import { BULK_USER_HEADER, DEPARTMENTS, USER_RULES } from "@/lib/departments"
import { ROLE_LABEL } from "@/lib/format"
import { cn } from "@/lib/utils"

const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "AUDITOR", "HEAD"]

/** Kept as text in the form; "" means no manager. */
const optionalId = z
  .string()
  .trim()
  .regex(/^([1-9][0-9]*)?$/, "Enter a valid employee ID")
  .transform((v) => (v ? Number(v) : null))

const schema = z
  .object({
    employeeCode: z.string().trim().regex(USER_RULES.employeeCode, "2–32 letters, digits, _ or -"),
    name: z.string().trim().min(2, "Enter the employee's full name").max(128, "Max 128 characters"),
    email: z.string().trim().min(1, "Enter a work email").max(190, "Max 190 characters").regex(USER_RULES.email, "That doesn't look like an email"),
    role: z.enum(["EMPLOYEE", "MANAGER", "AUDITOR", "HEAD"]),
    departmentId: z.coerce.number().int().positive("Pick a department"),
    managerId: optionalId,
    accountNumber: z.string().trim().regex(USER_RULES.accountNumber, "9–32 digits, no spaces"),
    ifsc: z.string().trim().toUpperCase().regex(USER_RULES.ifsc, "11 characters, like HDFC0001234"),
  })
  // `when` lets this run alongside other field errors, so all problems show at once.
  .refine((v) => v.role !== "EMPLOYEE" || v.managerId != null, { path: ["managerId"], message: "Employees need a manager", when: () => true })
type FormIn = z.input<typeof schema>
type F = z.output<typeof schema>

const DEFAULTS: FormIn = { employeeCode: "", name: "", email: "", role: "EMPLOYEE", departmentId: "" as unknown as number, managerId: "", accountNumber: "", ifsc: "" }

function copy(text: string, what = "Password") {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error("Couldn't copy — select it and copy by hand"),
  )
}

export default function RegisterUserPage() {
  const [mode, setMode] = useState<"single" | "bulk">("single")
  return (
    <>
      <PageHeader
        title="Register employee"
        sub="Create ExpenseFlow accounts. Each new account gets a one-time password — copy it now and share it with the employee directly."
        actions={<HeaderActions />}
      >
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "single", label: "One employee" },
            { value: "bulk", label: "Bulk CSV" },
          ]}
        />
      </PageHeader>
      {mode === "single" ? <SingleRegister /> : <BulkRegister />}
    </>
  )
}

/* ------------------------------------------------------------------ single */
function SingleRegister() {
  const [created, setCreated] = useState<CreateUserResponse[]>([])
  const { register, handleSubmit, formState, reset, setError, control } = useForm<FormIn, unknown, F>({ resolver: zodResolver(schema), defaultValues: DEFAULTS })
  const role = useWatch({ control, name: "role" })
  const err = formState.errors

  const m = useMutation({
    mutationFn: (v: F) => Api.createUser(v as CreateUserRequest),
    onSuccess: (res) => {
      setCreated((c) => [res, ...c])
      reset(DEFAULTS)
      toast.success(`${res.user.name} registered`, { description: "Copy the temporary password before you leave this page." })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 400 && e.problem.errors?.length) e.problem.errors.forEach((fe) => setError(fe.field as keyof FormIn, { message: fe.message }))
      else if (e instanceof ApiError && e.status === 409) setError(/code/i.test(e.problem.detail ?? "") ? "employeeCode" : "email", { message: e.problem.detail })
      else toastError(e, "Couldn't register employee")
    },
  })

  const latest = created[0]

  return (
    <div className="grid gap-4 px-4 pt-5 pb-10 sm:px-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="stagger self-start" style={{ "--i": 0 } as React.CSSProperties}>
        <CardHeader title="Employee details" sub="Fields follow the CreateUserRequest contract" />
        <form onSubmit={handleSubmit((v) => m.mutate(v))} noValidate className="grid gap-4 p-4 sm:grid-cols-2" data-testid="register-form">
          <Field label="Full name" htmlFor="name" error={err.name?.message}>
            <Input id="name" autoComplete="off" placeholder="Nitin Chopra" aria-invalid={!!err.name} data-testid="reg-name" {...register("name")} />
          </Field>
          <Field label="Employee code" htmlFor="employeeCode" error={err.employeeCode?.message}>
            <Input id="employeeCode" autoComplete="off" placeholder="E0211" aria-invalid={!!err.employeeCode} data-testid="reg-code" {...register("employeeCode")} />
          </Field>
          <Field label="Work email" htmlFor="regEmail" error={err.email?.message} className="sm:col-span-2">
            <Input id="regEmail" type="email" autoComplete="off" placeholder="name@company.com" aria-invalid={!!err.email} data-testid="reg-email" {...register("email")} />
          </Field>
          <Field label="Role" htmlFor="role" error={err.role?.message}>
            <Select id="role" data-testid="reg-role" {...register("role")}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Department" htmlFor="departmentId" error={err.departmentId?.message}>
            <Select id="departmentId" aria-invalid={!!err.departmentId} data-testid="reg-dept" {...register("departmentId")}>
              <option value="">Select…</option>
              {DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Manager employee ID"
            htmlFor="managerId"
            optional={role !== "EMPLOYEE"}
            error={err.managerId?.message}
            hint={role === "EMPLOYEE" ? "Their claims go to this manager first." : "Leave blank if they report to no one."}
            className="sm:col-span-2"
          >
            <Input id="managerId" inputMode="numeric" autoComplete="off" placeholder="21" aria-invalid={!!err.managerId} data-testid="reg-manager" {...register("managerId")} />
          </Field>
          <div className="sm:col-span-2 -mb-1 flex items-center gap-3 pt-1 text-[11.5px] tracking-[0.06em] text-ink-4 uppercase">
            Reimbursement account <span className="h-px flex-1 bg-line" />
          </div>
          <Field label="Bank account number" htmlFor="accountNumber" error={err.accountNumber?.message}>
            <Input id="accountNumber" inputMode="numeric" autoComplete="off" placeholder="100000000211" className="num" aria-invalid={!!err.accountNumber} data-testid="reg-account" {...register("accountNumber")} />
          </Field>
          <Field label="IFSC" htmlFor="ifsc" error={err.ifsc?.message}>
            <Input id="ifsc" autoComplete="off" placeholder="ICIC0000211" className="uppercase" maxLength={11} aria-invalid={!!err.ifsc} data-testid="reg-ifsc" {...register("ifsc")} />
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:col-span-2">
            <Button variant="ghost" onClick={() => reset(DEFAULTS)} disabled={m.isPending}>
              Clear
            </Button>
            <Button type="submit" variant="primary" loading={m.isPending} data-testid="register-submit">
              <UserPlus /> Register employee
            </Button>
          </div>
        </form>
      </Card>

      <div className="flex flex-col gap-4 self-start">
        <Card className="stagger overflow-hidden" style={{ "--i": 1 } as React.CSSProperties}>
          <CardHeader title="Temporary password" sub="Shown once — the server never returns it again" />
          {latest ? (
            <div className="p-4" data-testid="register-result">
              <div className="flex items-center gap-3">
                <Avatar name={latest.user.name} size={38} />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{latest.user.name}</p>
                  <p className="truncate text-[12px] text-ink-3">
                    {latest.user.employeeCode} · {ROLE_LABEL[latest.user.role]} · {latest.user.departmentName}
                  </p>
                </div>
              </div>
              <p className="mt-3 truncate text-[12.5px] text-ink-3">
                Sign-in email <span className="text-ink">{latest.user.email}</span>
              </p>
              <SecretField value={latest.temporaryPassword} className="mt-3" testId="temp-password" />
              <p className="mt-3 text-[12px] text-ink-3">Share it over a channel you trust. Don't email it alongside the username.</p>
            </div>
          ) : (
            <EmptyState icon={<KeyRound />} title="No account yet" body="Register an employee and their one-time password appears here." className="py-10" />
          )}
        </Card>

        {created.length > 1 && (
          <Card className="stagger overflow-hidden" style={{ "--i": 2 } as React.CSSProperties}>
            <CardHeader title="Registered this session" sub="Passwords are kept only until you leave this page" />
            <ul className="divide-y divide-line">
              {created.slice(1).map((c) => (
                <li key={c.user.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={c.user.name} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{c.user.name}</p>
                    <p className="truncate text-[11.5px] text-ink-3">{c.user.email}</p>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Copy password for ${c.user.name}`} onClick={() => copy(c.temporaryPassword)}>
                    <Copy />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}

function SecretField({ value, className, testId }: { value: string; className?: string; testId?: string }) {
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <div className={cn("flex items-center gap-1 rounded-control border border-line-strong bg-surface-2 py-1 pr-1 pl-3", className)}>
      <code className="num flex-1 truncate font-mono text-[14px] tracking-wide" data-testid={testId} data-value={value}>
        {show ? value : "•".repeat(value.length)}
      </code>
      <Button variant="ghost" size="icon-sm" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)}>
        {show ? <EyeOff /> : <Eye />}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy password"
        onClick={() => {
          copy(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ bulk */
function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }))
  const a = Object.assign(document.createElement("a"), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

const TEMPLATE = `${BULK_USER_HEADER}\nE0211,Nitin Chopra,nitin.c@company.com,EMPLOYEE,SALES,mgr.leave@expenseflow.test,100000000211,ICIC0000211\n`

function BulkRegister() {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<BulkUserResponse | null>(null)
  const [drag, setDrag] = useState(false)

  const m = useMutation({
    mutationFn: (f: File) => Api.bulkCreateUsers(f),
    onSuccess: (res) => {
      setResult(res)
      setFile(null)
      if (input.current) input.current.value = ""
      if (res.failed) toast.warning(`${res.succeeded} registered, ${res.failed} skipped`, { description: "Check the skipped rows below." })
      else toast.success(`${res.succeeded} employees registered`)
    },
    onError: (e) => toastError(e, "Upload failed"),
  })

  const pick = (f: File | undefined) => {
    if (!f) return
    if (!/\.csv$/i.test(f.name)) return toast.error("Choose a .csv file")
    if (f.size > 5 * 1024 * 1024) return toast.error("File too large", { description: "Max 5 MB" })
    setFile(f)
  }

  const exportResults = () => {
    if (!result) return
    const rows = result.results.map((r) => [r.row, r.employeeCode ?? "", r.email ?? "", r.outcome, r.temporaryPassword ?? "", r.errorDetail ?? ""].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    downloadText(`registered-users-${new Date().toISOString().slice(0, 10)}.csv`, ["row,employee_code,email,outcome,temporary_password,error", ...rows].join("\n"))
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 sm:px-6">
      <Card className="stagger" style={{ "--i": 0 } as React.CSSProperties}>
        <CardHeader
          title="Upload CSV"
          sub="One employee per row. Each row is processed on its own — bad rows are skipped, not fatal."
          action={
            <Button variant="outline" size="sm" onClick={() => downloadText("employees-template.csv", TEMPLATE)} data-testid="bulk-template">
              <Download /> Template
            </Button>
          }
        />
        <div className="p-4">
          <label
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              pick(e.dataTransfer.files[0])
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-dashed px-4 py-8 text-center transition-colors",
              drag ? "border-cobalt bg-info-soft" : "border-line-strong bg-surface-2 hover:border-ink-4",
            )}
          >
            <FileSpreadsheet className="size-7 text-ink-3" strokeWidth={1.6} />
            {file ? (
              <span className="text-[13.5px] font-medium">{file.name}</span>
            ) : (
              <span className="text-[13.5px] text-ink-2">
                <span className="font-medium text-ink">Choose a CSV</span> or drop it here
              </span>
            )}
            <span className="text-[12px] text-ink-3">UTF-8, max 5 MB</span>
            <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" data-testid="bulk-file" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <p className="mt-3 text-[12px] text-ink-3">
            Header must be <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[11.5px] break-all">{BULK_USER_HEADER}</code>. Department codes:{" "}
            {DEPARTMENTS.map((d) => `${d.code} (${d.name})`).join(", ")}.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            {file && (
              <Button variant="ghost" onClick={() => setFile(null)} disabled={m.isPending}>
                <X /> Remove
              </Button>
            )}
            <Button variant="primary" disabled={!file} loading={m.isPending} onClick={() => file && m.mutate(file)} data-testid="bulk-submit">
              <Upload /> Register from CSV
            </Button>
          </div>
        </div>
      </Card>

      {result && (
        <Card className="stagger overflow-hidden" style={{ "--i": 1 } as React.CSSProperties} data-testid="bulk-result">
          <CardHeader
            title="Results"
            sub={`${result.processed} rows · ${result.succeeded} registered · ${result.failed} skipped`}
            action={
              result.succeeded > 0 && (
                <Button variant="outline" size="sm" onClick={exportResults}>
                  <Download /> Download with passwords
                </Button>
              )
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-line text-[11.5px] tracking-[0.04em] text-ink-3 uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Row</th>
                  <th className="px-4 py-2.5 font-medium">Employee</th>
                  <th className="px-4 py-2.5 font-medium">Outcome</th>
                  <th className="px-4 py-2.5 font-medium">Temporary password / reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.results.map((r) => (
                  <tr key={r.row}>
                    <td className="num px-4 py-3 text-ink-3">{r.row}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.employeeCode ?? "—"}</p>
                      <p className="text-[12px] text-ink-3">{r.email ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">{r.outcome === "CREATED" ? <Badge tone="positive">Registered</Badge> : <Badge tone="danger">Skipped {r.errorStatus}</Badge>}</td>
                    <td className="px-4 py-3">
                      {r.temporaryPassword ? (
                        <span className="flex items-center gap-1">
                          <code className="font-mono text-[12.5px]">{r.temporaryPassword}</code>
                          <Button variant="ghost" size="icon-sm" aria-label={`Copy password for row ${r.row}`} onClick={() => copy(r.temporaryPassword!)}>
                            <Copy />
                          </Button>
                        </span>
                      ) : (
                        <span className="text-danger">{r.errorDetail}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
