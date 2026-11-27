import { Link } from "react-router-dom"
import { Compass } from "lucide-react"
import { EmptyState } from "@/components/ds/domain"
import { Button } from "@/components/ds/primitives"

export default function NotFoundPage() {
  return (
    <EmptyState
      className="flex-1 py-32"
      icon={<Compass />}
      title="This page doesn't exist"
      body="The link may be old, or you may not have access to it."
      action={
        <Link to="/">
          <Button variant="primary">Go home</Button>
        </Link>
      }
    />
  )
}
