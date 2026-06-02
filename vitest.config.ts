import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // E2E (Playwright) の spec を拾わないよう、ユニットテストだけに限定する
    include: ['tests/unit/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // tsconfig の "@/*" → リポジトリルート に合わせる
      '@': path.resolve(__dirname, '.'),
    },
  },
})
