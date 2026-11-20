import { afterAll, describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { LokHost, LokHostError } from './lokHost'

// These unit-test the send()/exit/dispose reject paths WITHOUT LibreOffice.
// The host binary is Node running a stand-in script that reads stdin until it
// is killed and never answers, so the real ChildProcess plumbing runs — the
// stdin pipe, the 'exit' handler, the pending map — but no command ever resolves.
// That lets us prove the failure classification (the "kills the 20s hang" fix)
// against real streams, not mocks. The sidecar-kill e2e (S-stability) proves the
// same against the REAL engine; this covers the branch cheaply/deterministically.
// LokHost spawns `hostBin installPath fundamentalrc`, so installPath is the script.
const STAND_IN = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-lok-standin-')), 'host.cjs')
fs.writeFileSync(STAND_IN, 'process.stdin.resume()\n')
afterAll(() => fs.rmSync(path.dirname(STAND_IN), { recursive: true, force: true }))
function fakeHost(): LokHost {
  return new LokHost({ hostBin: process.execPath, installPath: STAND_IN, fundamentalrc: 'unused' })
}

// send() is private; exercise it through the public ping() which calls it.
function sendViaPing(h: LokHost): Promise<unknown> {
  return (h as unknown as { send: (c: string) => Promise<unknown> }).send('ping')
}

function sendCmd(h: LokHost, cmd: string): Promise<unknown> {
  return (h as unknown as { send: (c: string) => Promise<unknown> }).send(cmd)
}

describe('LokHost failure classification', () => {
  it('rejects ALL in-flight calls with a classified error when the process exits', async () => {
    const h = fakeHost()
    const a = sendViaPing(h)
    const b = sendViaPing(h)
    // Kill the child — the stand-in dies, the host's 'exit' handler must fail both.
    ;(h as unknown as { proc: { kill: (s: string) => void } | null }).proc?.kill('SIGKILL')
    const [ra, rb] = await Promise.allSettled([a, b])
    expect(ra.status).toBe('rejected')
    expect(rb.status).toBe('rejected')
    for (const r of [ra, rb] as PromiseRejectedResult[]) {
      expect(r.reason).toBeInstanceOf(LokHostError)
      // Whichever fires first wins: the 'exit' event, or the broken stdin pipe
      // (first on Windows). Both mean the host is gone.
      expect(['exit', 'write']).toContain((r.reason as LokHostError).reason)
    }
  })

  it('fails fast (not-running) on a send() after the host is known dead', async () => {
    const h = fakeHost()
    ;(h as unknown as { proc: { kill: (s: string) => void } | null }).proc?.kill('SIGKILL')
    // Give the 'exit' event a tick to flip the dead flag.
    await new Promise((r) => setTimeout(r, 50))
    await expect(sendViaPing(h)).rejects.toMatchObject({ reason: 'not-running' })
  })

  it('rejects in-flight calls with reason "disposed" on dispose()', async () => {
    const h = fakeHost()
    const p = sendViaPing(h)
    h.dispose()
    await expect(p).rejects.toMatchObject({ reason: 'disposed' })
  })

  it('dispose() is idempotent (a second call is a no-op, no throw)', () => {
    const h = fakeHost()
    h.dispose()
    expect(() => h.dispose()).not.toThrow()
  })

  it('rejects with reason "write" when stdin is not writable', async () => {
    const h = fakeHost()
    // Destroy stdin so the write in send() takes the throw path, then call send
    // SYNCHRONOUSLY (before the async 'error' event loops and flips the dead
    // flag) so we hit the per-call write-failure branch, not the fast dead guard.
    const proc = (h as unknown as { proc: { stdin: { destroy: () => void } } | null }).proc
    proc?.stdin.destroy()
    const p = sendViaPing(h) // no await gap — the stdin 'error' hasn't fired yet
    await expect(p).rejects.toMatchObject({ reason: 'write' })
    h.dispose()
  })
})

/*
 * The protocol is newline-framed (std::getline in the C++ host), so a command
 * carrying a newline would inject a second attacker-controlled line — the
 * arbitrary-file-write finding. send() refuses frame-breakers at the boundary,
 * while still allowing the tab that `openopts` uses as a field separator.
 */
describe('LokHost.send protocol-injection guard', () => {
  it('rejects a command containing a newline', async () => {
    const h = fakeHost()
    await expect(sendCmd(h, 'open /tmp/x\n0 new scalc /tmp/evil/f')).rejects.toMatchObject({ reason: 'bad-command' })
    h.dispose()
  })
  it('rejects a carriage return and a null byte', async () => {
    const h = fakeHost()
    await expect(sendCmd(h, 'open a\rb')).rejects.toMatchObject({ reason: 'bad-command' })
    await expect(sendCmd(h, 'open a\0b')).rejects.toMatchObject({ reason: 'bad-command' })
    h.dispose()
  })
  it('allows a tab (the openopts field separator)', async () => {
    const h = fakeHost()
    // The stand-in never answers, so this times out rather than resolving — but it must
    // NOT be rejected with bad-command. Assert it does not reject synchronously.
    const p = sendCmd(h, 'openopts 59,34,76,1,,0,false,true\t/tmp/a.csv')
    const settled = await Promise.race([p.then(() => 'resolved', (e) => (e as { reason?: string }).reason ?? 'other'), new Promise((r) => setTimeout(() => r('pending'), 150))])
    expect(settled).not.toBe('bad-command')
    h.dispose()
  })
})

describe('LokHost secret-env scrubbing and frame-length ceiling (SEC-08)', () => {
  it('scrubs secret API keys from the child environment', async () => {
    const envDumpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-lok-env-')), 'dump.cjs')
    const outPath = path.join(path.dirname(envDumpFile), 'env.json')
    fs.writeFileSync(
      envDumpFile,
      `require('fs').writeFileSync(${JSON.stringify(outPath)}, JSON.stringify(process.env)); process.stdin.resume();\n`,
    )
    const prevKey = process.env.OPENAI_API_KEY
    const prevTok = process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    process.env.OPENAI_API_KEY = 'sk-should-not-leak-to-libreoffice'
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = 'ghp_should_not_leak'
    const h = new LokHost({ hostBin: process.execPath, installPath: envDumpFile, fundamentalrc: 'unused' })
    try {
      for (let i = 0; i < 40 && !fs.existsSync(outPath); i++) {
        await new Promise((r) => setTimeout(r, 25))
      }
      const childEnv = JSON.parse(fs.readFileSync(outPath, 'utf8')) as Record<string, string>
      expect(childEnv.OPENAI_API_KEY).toBeUndefined()
      expect(childEnv.GITHUB_PERSONAL_ACCESS_TOKEN).toBeUndefined()
    } finally {
      h.dispose()
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prevKey
      if (prevTok === undefined) delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN
      else process.env.GITHUB_PERSONAL_ACCESS_TOKEN = prevTok
      fs.rmSync(path.dirname(envDumpFile), { recursive: true, force: true })
    }
  })

  it('rejects a bogus multi-gigabyte frame header immediately instead of buffering unbounded memory', async () => {
    const giantFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-lok-frame-')), 'giant.cjs')
    // Emit a 4-byte uint32 LE frame length of 0x7fffffff (~2 GB) on fd 3 (JSON frame pipe) followed by 4 bytes.
    fs.writeFileSync(
      giantFile,
      `const fs = require('fs'); const h = Buffer.alloc(8); h.writeUInt32LE(0x7fffffff, 0); fs.writeSync(3, h); process.stdin.resume();\n`,
    )
    const h = new LokHost({ hostBin: process.execPath, installPath: giantFile, fundamentalrc: 'unused' })
    try {
      const p = sendViaPing(h)
      await expect(p).rejects.toBeInstanceOf(LokHostError)
    } finally {
      h.dispose()
      fs.rmSync(path.dirname(giantFile), { recursive: true, force: true })
    }
  })
})
