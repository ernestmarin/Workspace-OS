import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { synthesizeLocal } from './local'
import { decodePcmWav } from './wav'

function wav(): Buffer {
  const b = Buffer.alloc(48)
  b.write('RIFF', 0); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36)
  b.writeUInt32LE(4, 40); b.writeInt16LE(1, 44); b.writeInt16LE(-1, 46)
  return b
}

describe('local engine', () => {
  it('decodes valid PCM and rejects truncation or wrong format', () => {
    expect(decodePcmWav(wav())).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16, pcm: Buffer.from([1, 0, 255, 255]) })
    expect(() => decodePcmWav(wav().subarray(0, 46))).toThrow('Truncated')
    const compressed = wav(); compressed.writeUInt16LE(3, 20)
    expect(() => decodePcmWav(compressed)).toThrow('Unsupported')
  })
  it('passes text through a private input file, not shell arguments', async () => {
    const script = `const fs=require('fs'); if(fs.readFileSync(process.argv[1],'utf8')!=='hello $(echo bad)') process.exit(1); fs.writeFileSync(process.argv[2],Buffer.from('${wav().toString('base64')}','base64'))`
    const result = await synthesizeLocal({ text: 'hello $(echo bad)', voice: 'test', command: process.execPath, argsTemplate: ['-e', script, '{input}', '{output}'], engineDir: '' })
    expect(result.pcm.length).toBe(4)
  })
  it('does not inherit obvious provider credentials into a local engine', async () => {
    vi.stubEnv('WOS_OPENAI_API_KEY', 'audit-fixture-not-a-key')
    try {
      const script = `const fs=require('fs'); if(process.env.WOS_OPENAI_API_KEY)process.exit(4); fs.writeFileSync(process.argv[2],Buffer.from('${wav().toString('base64')}','base64'))`
      await expect(synthesizeLocal({ text: 'hello', voice: 'test', command: process.execPath, argsTemplate: ['-e', script, '{input}', '{output}'], engineDir: '' })).resolves.toMatchObject({ sampleRate: 24000 })
    } finally { vi.unstubAllEnvs() }
  })
  it.skipIf(process.platform === 'win32')('cancellation reaps a wrapper descendant, including one that ignores SIGTERM', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-speech-tree-test-'))
    const pidFile = path.join(dir, 'descendant.pid')
    const abort = new AbortController()
    let pid: number | undefined
    let settled = false
    const descendant = `process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)`
    const wrapper = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)},${JSON.stringify(pidFile)}],{stdio:'ignore'});setInterval(()=>{},1000)`
    const outcome = synthesizeLocal({ text: 'hello', voice: 'test', command: process.execPath, argsTemplate: ['-e', wrapper, '{input}', '{output}'], engineDir: '', signal: abort.signal }).then(() => 'unexpected success', (e: Error) => e.message).finally(() => { settled = true })
    try {
      await vi.waitFor(async () => { pid = Number(await fs.readFile(pidFile, 'utf8')); expect(pid).toBeGreaterThan(1) })
      abort.abort()
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 4000 })
      expect(await outcome).toContain('cancelled')
      const running = async (): Promise<boolean> => {
        try {
          process.kill(pid!, 0)
          // A killed orphan may briefly be a zombie until the container's init reaps it.
          if (process.platform === 'linux' && (await fs.readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1]?.startsWith('Z')) return false
          return true
        } catch { return false }
      }
      await vi.waitFor(async () => expect(await running()).toBe(false), { timeout: 1000 })
    } finally {
      abort.abort()
      if (pid) { try { process.kill(pid, 'SIGKILL') } catch { /* test cleanup */ } }
      await outcome
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  it('cancels a running process and rejects missing templates', async () => {
    const controller = new AbortController()
    const running = synthesizeLocal({ text: 'hello', voice: 'test', command: process.execPath, argsTemplate: ['-e', 'setTimeout(()=>{},10000)', '{input}', '{output}'], engineDir: '', signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(running).rejects.toThrow('cancelled')
    await expect(synthesizeLocal({ text: 'hello', voice: 'test', command: process.execPath, argsTemplate: [], engineDir: '' })).rejects.toThrow('placeholders')
  })
})
