import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadGetSiteOrigin(headerEntries: Record<string, string>) {
  vi.resetModules()
  const headersMap = new Map(Object.entries(headerEntries))
  vi.doMock('next/headers', () => ({
    headers: async () => ({
      get: (key: string) => headersMap.get(key) ?? null,
    }),
  }))

  const { getSiteOrigin } = await import('@/lib/site-origin')
  return getSiteOrigin()
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getSiteOrigin', () => {
  it('uses x-forwarded-host and x-forwarded-proto when both are present', async () => {
    const origin = await loadGetSiteOrigin({
      'x-forwarded-host': 'example.com',
      'x-forwarded-proto': 'http',
      host: 'internal-host:3000',
    })

    expect(origin).toBe('http://example.com')
  })

  it('infers https when only x-forwarded-host is present', async () => {
    const origin = await loadGetSiteOrigin({ 'x-forwarded-host': 'example.com' })

    expect(origin).toBe('https://example.com')
  })

  it('falls back to the host header when x-forwarded-host is absent', async () => {
    const origin = await loadGetSiteOrigin({ host: 'example.com' })

    expect(origin).toBe('https://example.com')
  })

  it('uses http for a localhost host', async () => {
    const origin = await loadGetSiteOrigin({ host: 'localhost:3000' })

    expect(origin).toBe('http://localhost:3000')
  })

  it('uses http for a 127.0.0.1 host', async () => {
    const origin = await loadGetSiteOrigin({ host: '127.0.0.1:3000' })

    expect(origin).toBe('http://127.0.0.1:3000')
  })

  it('falls back to the default host and http when no headers are present', async () => {
    const origin = await loadGetSiteOrigin({})

    expect(origin).toBe('http://localhost:3000')
  })
})
