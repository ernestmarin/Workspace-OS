import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  classifyModelReadiness,
  recoveryHints,
  buildModelDiagnostic,
  verifyReviewedSpeechModels,
  type ModelReadiness,
} from './modelDiagnostics'
import type { ArtifactVerificationResult } from './modelVerifier'
import type { SpeechModelManifestEntry } from '../../shared/speech/modelManifest'

/**
 * VOX-A4c — model integrity diagnostics.
 *
 * The rule this suite exists to pin: **a file being present is not readiness.**
 * The old status surfaces (`kokoroFilesStatus`, `localSttStatus`) answered "are
 * the bytes there?", and the UI showed that as a green light. These tests
 * verify against REAL bytes on a temporary directory, so the distinction between
 * "present", "unverified" and "verified" is demonstrated, not asserted.
 */
const sha = (data: Buffer): string => crypto.createHash('sha256').update(data).digest('hex')

const art = (status: ArtifactVerificationResult['status'], relativePath = 'f.bin'): ArtifactVerificationResult =>
  ({ relativePath, status, bytes: status === 'missing' ? 0 : 10 })

describe('classifyModelReadiness (VOX-A4c)', () => {
  const cases: Array<[string, ArtifactVerificationResult[], ModelReadiness]> = [
    ['every artifact missing', [art('missing'), art('missing', 'g.bin')], 'missing'],
    ['some missing, some present', [art('present-unpinned'), art('missing', 'g.bin')], 'missing'],
    ['present but unpinned is NOT ready', [art('present-unpinned'), art('present-unpinned', 'g.bin')], 'unverified_files_present'],
    ['a mismatched hash is corruption', [art('verified'), art('hash-mismatch', 'g.bin')], 'corrupt'],
    ['an escaped path is a refusal', [art('verified'), art('invalid-path', 'g.bin')], 'invalid_location'],
    ['all pinned and matching is the only verified state', [art('verified'), art('verified', 'g.bin')], 'verified_offline'],
    ['an empty file counts as missing', [art('empty'), art('verified', 'g.bin')], 'missing'],
  ]
  for (const [name, artifacts, expected] of cases) {
    it(name, () => {
      expect(classifyModelReadiness(artifacts)).toBe(expected)
    })
  }
})

describe('recoveryHints (VOX-A4c)', () => {
  it('names the exact files to provision and promises no download', () => {
    const hints = recoveryHints('missing', [art('missing', 'onnx/model.onnx')])
    expect(hints).toHaveLength(1)
    expect(hints[0].code).toBe('provision-files')
    expect(hints[0].files).toEqual(['onnx/model.onnx'])
    expect(hints[0].message).toMatch(/nothing is downloaded automatically/i)
  })

  it('points at the corrupt artifact by path, never at "reinstall everything"', () => {
    const hints = recoveryHints('corrupt', [art('hash-mismatch', 'voices-v1.0.bin')])
    expect(hints[0].code).toBe('replace-corrupt-artifact')
    expect(hints[0].files).toEqual(['voices-v1.0.bin'])
  })

  it('explains a refusal without suggesting the user change permissions', () => {
    const hints = recoveryHints('invalid_location', [art('invalid-path', 'link.onnx')])
    expect(hints[0].code).toBe('fix-model-directory')
    expect(hints[0].code).not.toBe('provision-files')
  })

  it('says plainly that present-but-unverified files are not usable', () => {
    const hints = recoveryHints('unverified_files_present', [art('present-unpinned')])
    expect(hints[0].message).toMatch(/nothing about them has been verified/i)
  })

  it('offers nothing to fix when the model is verified', () => {
    expect(recoveryHints('verified_offline', [art('verified')])).toEqual([])
  })
})

describe('buildModelDiagnostic (VOX-A4c)', () => {
  const entry: SpeechModelManifestEntry = {
    id: 'piper-es-local',
    label: 'Piper',
    role: 'tts',
    license: 'MIT',
    languages: ['es'],
    notes: 'test',
    artifacts: [
      { relativePath: 'piper/a.onnx', expectedSha256: null, minBytes: 1 },
      { relativePath: 'piper/a.onnx.json', expectedSha256: 'deadbeef', minBytes: 1 },
    ],
  }

  it('never marks an unpinned model ready, whatever is on disk', () => {
    const d = buildModelDiagnostic(entry, '/models', [art('present-unpinned', 'piper/a.onnx'), art('present-unpinned', 'piper/a.onnx.json')])
    expect(d.ready).toBe(false)
    expect(d.readiness).toBe('unverified_files_present')
    expect(d.counts.unverified).toBe(2)
    expect(d.counts.verified).toBe(0)
  })

  it('separates present from verified in the counts', () => {
    const d = buildModelDiagnostic(entry, '/models', [art('verified', 'piper/a.onnx'), art('present-unpinned', 'piper/a.onnx.json')])
    expect(d.counts.present).toBe(2)
    expect(d.counts.verified).toBe(1)
    expect(d.ready).toBe(false)
  })

  it('is ready only when every artifact is pinned and matching', () => {
    const d = buildModelDiagnostic(entry, '/models', [art('verified', 'piper/a.onnx'), art('verified', 'piper/a.onnx.json')])
    expect(d.ready).toBe(true)
    expect(d.readiness).toBe('verified_offline')
  })
})

describe('verifyReviewedSpeechModels — against real bytes', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-models-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const write = async (rel: string, data: Buffer): Promise<void> => {
    const target = path.join(root, rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, data)
  }

  const entry = (expectedSha256: string | null): SpeechModelManifestEntry => ({
    id: 'whisper-onnx-local',
    label: 'Whisper',
    role: 'stt',
    license: 'MIT',
    languages: ['en'],
    notes: 'test',
    artifacts: [{ relativePath: 'onnx/model.onnx', expectedSha256, minBytes: 4 }],
  })

  it('reports missing when the directory does not exist at all', async () => {
    const report = await verifyReviewedSpeechModels(() => path.join(root, 'nope'), [entry(null)])
    expect(report.models[0].readiness).toBe('missing')
    expect(report.models[0].ready).toBe(false)
    expect(report.models[0].recovery[0].code).toBe('provision-files')
  })

  it('reports unverified_files_present for real bytes with no pin', async () => {
    await write('onnx/model.onnx', Buffer.from('real model bytes'))
    const report = await verifyReviewedSpeechModels(() => root, [entry(null)])
    const m = report.models[0]
    expect(m.readiness).toBe('unverified_files_present')
    expect(m.ready).toBe(false)
    expect(m.counts.present).toBe(1)
    expect(m.artifacts[0].status).toBe('present-unpinned')
  })

  it('reports verified_offline when the pinned hash matches the bytes', async () => {
    const bytes = Buffer.from('real model bytes')
    await write('onnx/model.onnx', bytes)
    const report = await verifyReviewedSpeechModels(() => root, [entry(sha(bytes))])
    expect(report.models[0].readiness).toBe('verified_offline')
    expect(report.models[0].ready).toBe(true)
    expect(report.models[0].counts.verified).toBe(1)
  })

  it('reports corrupt when the bytes changed under a pinned hash', async () => {
    await write('onnx/model.onnx', Buffer.from('tampered model bytes'))
    const report = await verifyReviewedSpeechModels(() => root, [entry(sha(Buffer.from('real model bytes')))])
    expect(report.models[0].readiness).toBe('corrupt')
    expect(report.models[0].ready).toBe(false)
    expect(report.models[0].recovery[0].code).toBe('replace-corrupt-artifact')
  })

  it('refuses a symlink planted at the artifact path', async () => {
    const outside = path.join(root, '..', `outside-${Date.now()}.onnx`)
    await fs.writeFile(outside, Buffer.from('outside bytes'))
    try {
      await fs.mkdir(path.join(root, 'onnx'), { recursive: true })
      await fs.symlink(outside, path.join(root, 'onnx', 'model.onnx'))
      const report = await verifyReviewedSpeechModels(() => root, [entry(sha(Buffer.from('outside bytes')))])
      expect(report.models[0].readiness).toBe('invalid_location')
      expect(report.models[0].ready).toBe(false)
    } finally {
      await fs.rm(outside, { force: true })
    }
  })

  it('treats an empty file as missing rather than usable', async () => {
    await write('onnx/model.onnx', Buffer.alloc(0))
    const report = await verifyReviewedSpeechModels(() => root, [entry(null)])
    expect(report.models[0].readiness).toBe('missing')
    expect(report.models[0].artifacts[0].status).toBe('empty')
  })

  it('stamps when the check ran, so a stale green cannot be presented as live', async () => {
    const fixed = new Date('2026-01-02T03:04:05.000Z')
    const report = await verifyReviewedSpeechModels(() => root, [entry(null)], () => fixed)
    expect(report.checkedAt).toBe('2026-01-02T03:04:05.000Z')
    expect(report.manifestVersion).toBeGreaterThan(0)
  })

  it('classifies every reviewed model without throwing on an absent root', async () => {
    const report = await verifyReviewedSpeechModels(() => path.join(root, 'absent'))
    expect(report.models.length).toBeGreaterThan(0)
    for (const m of report.models) {
      expect(m.ready).toBe(false)
      expect(m.readiness).toBe('missing')
      expect(m.recovery.length).toBeGreaterThan(0)
    }
  })
})
