import { describe, it, expect } from 'vitest'
import { isValidUuid } from '@/lib/validators'

describe('isValidUuid', () => {
  it('accepts a valid lowercase UUID', () => {
    expect(isValidUuid('6defef7b-59e2-4ade-8943-4c51487118e6')).toBe(true)
  })

  it('accepts an uppercase UUID (case-insensitive)', () => {
    expect(isValidUuid('6DEFEF7B-59E2-4ADE-8943-4C51487118E6')).toBe(true)
  })

  it('rejects malformed strings', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false)
    // ハイフン無し
    expect(isValidUuid('6defef7b59e24ade89434c51487118e6')).toBe(false)
    // 末尾が1桁足りない
    expect(isValidUuid('6defef7b-59e2-4ade-8943-4c51487118e')).toBe(false)
    // 不正な文字（g）を含む
    expect(isValidUuid('6defef7b-59e2-4ade-8943-4c51487118eg')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidUuid('')).toBe(false)
  })

  it('rejects whitespace-padded UUIDs (anchored regex)', () => {
    expect(isValidUuid(' 6defef7b-59e2-4ade-8943-4c51487118e6')).toBe(false)
    expect(isValidUuid('6defef7b-59e2-4ade-8943-4c51487118e6 ')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isValidUuid(null)).toBe(false)
    expect(isValidUuid(undefined)).toBe(false)
    expect(isValidUuid(123)).toBe(false)
    expect(isValidUuid({})).toBe(false)
    expect(isValidUuid(['6defef7b-59e2-4ade-8943-4c51487118e6'])).toBe(false)
  })
})
