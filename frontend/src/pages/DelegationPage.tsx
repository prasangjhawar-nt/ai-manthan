import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowRight, CalendarRange, UserRoundCog } from "lucide-react"
import { Api } from "@/api/endpoints"
import { ApiError } from "@/api/client"
import { useDelegations, toastError } from "@/api/hooks"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/lib/auth"
import { HeaderActions } from "@/components/layout/AppShell"
import { EmptyState, ErrorState, PageHeader } from "@/components/ds/domain"
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, Skeleton } from "@/components/ds/primitives"
import { dateLong } from "@/lib/format"

const today = () => new Date().toISOString().slice(0, 10)
const schema = z
  .object({
    delegateId: z.number({ error: "Enter the delegate's employee ID" }).int().positive(),
    fromDate: z.string().min(1, "Pick a start date"),
    toDate: z.string().min(1, "Pick an end date"),
  })
  .refine((v) => v.toDate >= v.fromDate, { path: ["toDate"], message: "Must be on or after the start date" })
type F = z.infer<typeof schema>

export default function DelegationPage() {
  const { user } = useAuth()
  const { data, isLoading, error, refetch } = useDelegations()
  const qc = useQueryClient()
  const { register, handleSubmit, formState, reset, setError } = useForm<F>({ resolver: zodResolver(schema), defaultValues: { fromDate: today(), toDate: today() } })
  const m = useMutation({
    mutationFn: (v: F) => Api.createDelegation(v),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["delegations"] })
      reset({ fromDate: today(), toDate: today() })
      toast.success("Delegation created", { description: `${d.delegateName ?? `Employee ${d.delegateId}`} can approve for you ${dateLong(d.fromDate)} – ${dateLong(d.toDate)}.` })
    },
    onError: (e) => {
      if (e instanceof ApiError && e.problem.errors?.length) e.problem.errors.forEach((fe) => setError(fe.field as keyof F, { message: fe.message }))
      else toastError(e, "Couldn't create delegation")
    },
  })

  return (
    <>
      <PageHeader title="Delegation" sub="Going on leave? Let a colleague approve on your behalf. Both names are kept in the audit trail." actions={<HeaderActions />} />
      <div className="grid gap-4 px-4 pt-5 pb-10 sm:px-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="stagger self-start" style={{ "--i": 0 } as React.CSSProperties}>
          <CardHeader title="New delegation" />
          <form onSubmit={handleSubmit((v) => m.mutate(v))} noValidate className="flex flex-col gap-4 p-4">
            <Field label="Delegate employee ID" htmlFor="delegateId" error={formState.errors.delegateId?.message} hint="The colleague's employee ID (shown on their profile). They can act at manager level within these dates.">
              <Input id="delegateId" type="number" inputMode="numeric" aria-invalid={!!formState.errors.delegateId} data-testid="delegate-id" {...register("delegateId", { valueAsNumber: true })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" htmlFor="fromDate" error={formState.errors.fromDate?.message}>
                <Input id="fromDate" type="date" data-testid="delegate-from" {...register("fromDate")} />
              </Field>
              <Field label="To" htmlFor="toDate" error={formState.errors.toDate?.message}>
                <Input id="toDate" type="date" aria-invalid={!!formState.errors.toDate} data-testid="delegate-to" {...register("toDate")} />
              </Field>
            </div>
            <Button type="submit" variant="primary" loading={m.isPending} data-testid="create-delegation">
              Create delegation
            </Button>
          </form>
        </Card>

        <Card className="stagger self-start overflow-hidden" style={{ "--i": 1 } as React.CSSProperties}>
          <CardHeader title="Your delegations" sub="Given and received" />
          {error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : isLoading ? (
            <div className="space-y-3 p-4">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : !data?.length ? (
            <EmptyState icon={<UserRoundCog />} title="No delegations" body="Create one before you go on leave so claims don't pile up." />
          ) : (
            <ul className="divide-y divide-line">
              {data.map((d, i) => {
                const mine = d.approverId === user?.id
                return (
                  <li key={d.id} className="stagger flex flex-wrap items-center gap-3 px-4 py-3.5" style={{ "--i": i } as React.CSSProperties}>
                    <div className="flex items-center gap-2 text-[13px]">
                      <Avatar name={d.approverName ?? "?"} size={28} />
                      <span className="font-medium">{mine ? "You" : d.approverName}</span>
                      <ArrowRight className="size-3.5 text-ink-4" />
                      <Avatar name={d.delegateName ?? "?"} size={28} />
                      <span className="font-medium">{d.delegateId === user?.id ? "You" : d.delegateName}</span>
                    </div>
                    <span className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
                      <CalendarRange className="size-3.5" /> {dateLong(d.fromDate)} – {dateLong(d.toDate)}
                    </span>
                    <span className="ml-auto">{d.active ? <Badge tone="positive" dot pulse>Active</Badge> : <Badge>{d.toDate < today() ? "Expired" : "Scheduled"}</Badge>}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
