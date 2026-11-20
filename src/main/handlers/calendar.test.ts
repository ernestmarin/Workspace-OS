import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let tmpUserData = ''

vi.mock('electron', () => ({
  app: { getPath: () => tmpUserData },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('ENC::' + s, 'utf8'),
    decryptString: (b: Buffer) => {
      const s = b.toString('utf8')
      return s.startsWith('ENC::') ? s.slice(5) : s
    },
  },
}))

const { googleRefreshSpy, msRefreshSpy } = vi.hoisted(() => ({
  googleRefreshSpy: vi.fn(
    async (params: { clientId: string; refreshToken: string }, fetchFn: unknown) => {
      if (typeof fetchFn !== 'function') throw new TypeError('fetchFn is not a function')
      if (!params.clientId || !params.refreshToken) throw new Error('missing OAuth refresh params')
      return { ok: true as const, value: { accessToken: 'goog-at', expiresAt: Date.now() + 3_600_000 } }
    },
  ),
  msRefreshSpy: vi.fn(
    async (params: { clientId: string; refreshToken: string; scopes?: string[] }, fetchFn: unknown) => {
      if (typeof fetchFn !== 'function') throw new TypeError('fetchFn is not a function')
      if (!params.clientId || !params.refreshToken) throw new Error('missing OAuth refresh params')
      return { ok: true as const, value: { accessToken: 'ms-at', expiresAt: Date.now() + 3_600_000 } }
    },
  ),
}))

vi.mock('../mail/oauth/google-oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mail/oauth/google-oauth')>()
  return { ...actual, refreshAccessToken: googleRefreshSpy }
})

vi.mock('../mail/oauth/microsoft-oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../mail/oauth/microsoft-oauth')>()
  return { ...actual, refreshAccessToken: msRefreshSpy }
})

import { calendarSourceStore, probeCalendarSource } from './calendar'
import { MS_CALENDAR_SCOPE } from '../calendar/cloud-providers'
import { saveClientId } from '../mail/oauth/client-config'

describe('calendar OAuth token refresh', () => {
  beforeAll(() => {
    tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-cal-oauth-'))
    saveClientId(tmpUserData, 'google', 'google-client-id')
    saveClientId(tmpUserData, 'microsoft', 'ms-client-id')
  })

  afterAll(() => {
    fs.rmSync(tmpUserData, { recursive: true, force: true })
  })

  it('refreshes Google and Microsoft sources with structured params + fetchFn', async () => {
    const store = calendarSourceStore()
    const googleSource = await store.add({
      kind: 'google',
      url: 'https://www.googleapis.com/calendar/v3',
      displayName: 'Google',
      password: 'google-refresh-token',
    })
    const msSource = await store.add({
      kind: 'microsoft',
      url: 'https://graph.microsoft.com/v1.0',
      displayName: 'Microsoft',
      password: 'ms-refresh-token',
    })

    expect(await probeCalendarSource(googleSource.id)).toBe('ok')
    expect(googleRefreshSpy).toHaveBeenCalledWith(
      { clientId: 'google-client-id', refreshToken: 'google-refresh-token' },
      expect.any(Function),
    )

    expect(await probeCalendarSource(msSource.id)).toBe('ok')
    expect(msRefreshSpy).toHaveBeenCalledWith(
      {
        clientId: 'ms-client-id',
        refreshToken: 'ms-refresh-token',
        scopes: [MS_CALENDAR_SCOPE, 'offline_access'],
      },
      expect.any(Function),
    )
  })
})
