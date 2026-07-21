import { createPolicy } from '@/lib/rate-limit'

const TEN_MINUTES = 10 * 60 * 1000
const ONE_HOUR = 60 * 60 * 1000

// 会員向け API の上限。イベント公開直後に参加が集中する運用を踏まえ、
// 通常利用では絶対に当たらない値に置いている（乱用の頭打ちが目的）。
//
// 管理者ログイン（ADM-03）と違い、サービス全体で共有する global キーは使わない。
// 入れると利用者1人の連打でサービス全体を止められてしまうため。

export const JOIN_LIMIT = createPolicy({ windowMs: TEN_MINUTES, lockMs: TEN_MINUTES, maxAttempts: 30 })
export const CANCEL_MEMBER_LIMIT = createPolicy({ windowMs: TEN_MINUTES, lockMs: TEN_MINUTES, maxAttempts: 30 })

// 会員登録前の臨時コードによるキャンセルは IP キーでしか縛れない。
// 同一回線の複数利用者が巻き添えになるため、他より低めだが極端に絞らない。
export const CANCEL_LEGACY_LIMIT = createPolicy({ windowMs: TEN_MINUTES, lockMs: TEN_MINUTES, maxAttempts: 10 })

export const REGISTER_LIMIT = createPolicy({ windowMs: ONE_HOUR, lockMs: ONE_HOUR, maxAttempts: 60 })
export const RENAME_LIMIT = createPolicy({ windowMs: ONE_HOUR, lockMs: ONE_HOUR, maxAttempts: 20 })
