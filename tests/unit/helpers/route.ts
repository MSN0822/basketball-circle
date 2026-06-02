import type { NextRequest } from 'next/server'

export function jsonRequest(
  body: unknown,
  init: { method?: string; headers?: Record<string, string>; url?: string } = {}
): NextRequest {
  return new Request(init.url ?? 'http://localhost/test', {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

export function emptyRequest(init: { method?: string; headers?: Record<string, string>; url?: string } = {}): NextRequest {
  return new Request(init.url ?? 'http://localhost/test', {
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
  }) as unknown as NextRequest
}

export async function responseJson<T = Record<string, unknown>>(res: Response): Promise<T> {
  return await res.json()
}

