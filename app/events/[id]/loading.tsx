import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />
}

export default function Loading() {
  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <Bar className="h-5 w-24" />

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Bar className="h-7 w-64 max-w-[70%]" />
          <Bar className="h-6 w-20 rounded-full" />
        </div>
        <Bar className="h-4 w-56" />
        <Bar className="h-4 w-44" />
      </div>

      <Separator />

      <Card>
        <CardHeader className="pb-3">
          <Bar className="h-5 w-20" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Bar className="h-9 w-full" />
          <Bar className="h-9 w-full" />
        </CardContent>
      </Card>

      <Separator />

      <div className="space-y-3">
        <Bar className="h-5 w-28" />
        <Bar className="h-12 w-full" />
        <Bar className="h-12 w-full" />
      </div>
    </main>
  )
}
