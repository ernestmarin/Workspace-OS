import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { synthesizePiper } from './piper'
import { terminateSpeechChildTree } from './process'

function wav(): Buffer {
  const b = Buffer.alloc(48)
  b.write('RIFF', 0); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(22050, 24); b.writeUInt32LE(44100, 28)
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36)
  b.writeUInt32LE(4, 40); b.writeInt16LE(12, 44); b.writeInt16LE(-12, 46)
  return b
}

describe('Spanish-capable local Piper TTS adapter & Windows tree cleanup (VOX-A4e & VOX-A4f)', () => {
  it('synthesizes Spanish UTF-8 prose offline through stdin without shell args or secret leakage', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-piper-test-'))
    const voicesDir = path.join(dir, 'piper')
    await fs.mkdir(voicesDir, { recursive: true })
    await fs.writeFile(path.join(voicesDir, 'es_ES-davefx-medium.onnx'), 'onnx-placeholder')
    await fs.writeFile(path.join(voicesDir, 'es_ES-davefx-medium.onnx.json'), '{"audio":{"sample_rate":22050}}')

    const fakePiper = path.join(dir, 'fake-piper.cjs')
    await fs.writeFile(
      fakePiper,
      [
        `const fs = require('fs');`,
        `if (process.env.OPENAI_API_KEY) process.exit(9);`,
        `const args = process.argv.slice(2);`,
        `const outIdx = args.indexOf('--output_file');`,
        `let text = '';`,
        `process.stdin.setEncoding('utf8');`,
        `process.stdin.on('data', (c) => { text += c; });`,
        `process.stdin.on('end', () => {`,
        `  if (!text.includes('¡Hola! El informe está listo.')) process.exit(3);`,
        `  fs.writeFileSync(args[outIdx + 1], Buffer.from(${JSON.stringify(wav().toString('base64'))}, 'base64'));`,
        `});`,
      ].join('\n'),
    )

    vi.stubEnv('OPENAI_API_KEY', 'sk-secret-do-not-leak')
    try {
      const audio = await synthesizePiper({
        text: '¡Hola! El informe está listo.',
        voice: 'es_ES-davefx-medium',
        engineDir: dir,
        command: process.execPath,
        leadingArgs: [fakePiper],
      })
      expect(audio.sampleRate).toBe(22050)
      expect(audio.pcm.length).toBe(4)
    } finally {
      vi.unstubAllEnvs()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects path traversal in voice id or missing .onnx/.onnx.json prerequisites', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-piper-bad-'))
    try {
      await expect(synthesizePiper({
        text: 'Hola',
        voice: '../outside',
        engineDir: dir,
      })).rejects.toThrow(/Invalid Piper voice/i)

      await expect(synthesizePiper({
        text: 'Hola',
        voice: 'es_ES-davefx-medium',
        engineDir: dir,
      })).rejects.toThrow(/Piper voice model files are not installed/i)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('uses taskkill /PID <pid> /T /F on win32 to reap descendant process trees (VOX-A4f)', () => {
    const spawner = vi.fn(() => ({ unref: vi.fn(), on: vi.fn() }))
    const childKill = vi.fn()
    terminateSpeechChildTree({ pid: 4321, kill: childKill }, true, 'win32', spawner as never)
    expect(spawner).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '4321', '/T', '/F'],
      expect.objectContaining({ shell: false, windowsHide: true, stdio: 'ignore' }),
    )
  })
})
