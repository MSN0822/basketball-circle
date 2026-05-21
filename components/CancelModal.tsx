'use client'

import { useState } from 'react'
import { Participant } from '@/lib/supabase'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Props {
  participant: Participant
  onClose: () => void
}

const STORAGE_KEY = 'basketball_user_code'

export default function CancelModal({ participant, onClose }: Props) {
  const [code, setCode] = useState(
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) ?? '' : ''
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCancel() {
    if (!code.trim()) {
      setError('参加コードを入力してください')
      return
    }
    setLoading(true)
    setError('')

    const res = await fetch('/api/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_id: participant.id, user_code: code.trim() }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'キャンセルに失敗しました')
      return
    }

    onClose()
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>キャンセル確認</DialogTitle>
          <DialogDescription>
            <strong>{participant.name}</strong> さんの参加をキャンセルします。
            申請時に表示された5桁の参加コードを入力してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="code">参加コード（5桁）</Label>
            <Input
              id="code"
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={5}
              placeholder="例: 12345"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              戻る
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={loading}>
              {loading ? '処理中...' : 'キャンセルする'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
