'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

// Error Boundary は Client Component である必要がある（Next.js の規約）。
// Server Component から throw された error は、本番では digest だけがクライアントへ渡る。
export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[error boundary]', error)
  }, [error])

  return (
    <main className="max-w-lg mx-auto px-4 py-16 space-y-4 text-center">
      <h1 className="text-xl font-bold">情報を取得できませんでした</h1>
      <p className="text-sm text-muted-foreground">
        一時的な通信エラーの可能性があります。少し時間をおいてから、もう一度お試しください。
        <br />
        繰り返し表示される場合は運営にお知らせください。
      </p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">エラーID: {error.digest}</p>
      )}
      <div className="pt-2">
        <Button onClick={() => unstable_retry()}>再読み込み</Button>
      </div>
    </main>
  )
}
