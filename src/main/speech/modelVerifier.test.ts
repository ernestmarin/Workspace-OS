import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REVIEWED_SPEECH_MODELS } from '../../shared/speech/modelManifest'
import { verifyModelArtifacts } from './modelVerifier'

describe('speech model/license/hash manifest & offline verifier (VOX-A4b)', () => {
  it('lists reviewed licenses, languages, and English-only vs Spanish-capable metadata without network access', () => {
    const kokoro = REVIEWED_SPEECH_MODELS.find((m) => m.id === 'kokoro-v1.0-en')
    const whisper = REVIEWED_SPEECH_MODELS.find((m) => m.id === 'whisper-onnx-local')
    const piperEs = REVIEWED_SPEECH_MODELS.find((m) => m.id === 'piper-es-local')

    expect(kokoro).toMatchObject({ license: 'Apache-2.0', languages: ['en'] })
    expect(whisper?.license).toBe('MIT')
    expect(piperEs?.languages).toContain('es')
  })

  it('distinguishes missing, empty, hash-mismatch, unpinned-present, and sha256-verified artifacts offline', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-model-verify-'))
    try {
      const goodBytes = Buffer.from('deterministic-onnx-fixture')
      const goodSha = crypto.createHash('sha256').update(goodBytes).digest('hex')
      await fs.writeFile(path.join(dir, 'verified.onnx'), goodBytes)
      await fs.writeFile(path.join(dir, 'corrupt.onnx'), Buffer.from('tampered'))
      await fs.writeFile(path.join(dir, 'empty.onnx'), Buffer.alloc(0))
      await fs.writeFile(path.join(dir, 'unpinned.bin'), Buffer.from('user-supplied'))

      const report = await verifyModelArtifacts(dir, [
        { relativePath: 'verified.onnx', expectedSha256: goodSha, minBytes: 4 },
        { relativePath: 'corrupt.onnx', expectedSha256: goodSha, minBytes: 4 },
        { relativePath: 'empty.onnx', expectedSha256: null, minBytes: 1 },
        { relativePath: 'missing.onnx', expectedSha256: goodSha, minBytes: 1 },
        { relativePath: 'unpinned.bin', expectedSha256: null, minBytes: 1 },
        { relativePath: '../escape.onnx', expectedSha256: null, minBytes: 1 },
      ])

      expect(report.map((r) => [r.relativePath, r.status])).toEqual([
        ['verified.onnx', 'verified'],
        ['corrupt.onnx', 'hash-mismatch'],
        ['empty.onnx', 'empty'],
        ['missing.onnx', 'missing'],
        ['unpinned.bin', 'present-unpinned'],
        ['../escape.onnx', 'invalid-path'],
      ])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
