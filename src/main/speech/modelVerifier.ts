/**
 * Offline integrity verifier for local speech model artifacts (VOX-A4b).
 *
 * Never performs network access. Confines all relative paths inside `baseDir`
 * (rejecting symlinks and `..` traversal) and distinguishes `'verified'`
 * (pinned SHA-256 matched) from `'present-unpinned'` (non-empty file with no
 * pinned hash), `'hash-mismatch'`, `'empty'`, `'missing'`, and `'invalid-path'`.
 */
import crypto from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import path from 'node:path'
import type { SpeechModelArtifactSpec } from '../../shared/speech/modelManifest'

export type ArtifactVerificationStatus =
  | 'verified'
  | 'present-unpinned'
  | 'hash-mismatch'
  | 'empty'
  | 'missing'
  | 'invalid-path'

export interface ArtifactVerificationResult {
  relativePath: string
  status: ArtifactVerificationStatus
  bytes: number
  actualSha256?: string
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function verifyModelArtifacts(
  baseDir: string,
  specs: readonly SpeechModelArtifactSpec[],
): Promise<ArtifactVerificationResult[]> {
  const resolvedBase = path.resolve(baseDir)
  let realBase = resolvedBase
  try {
    realBase = await fs.realpath(resolvedBase)
  } catch {
    // baseDir itself may not exist yet; individual items will report 'missing'.
  }

  const results: ArtifactVerificationResult[] = []
  for (const spec of specs) {
    if (
      !spec.relativePath ||
      path.isAbsolute(spec.relativePath) ||
      spec.relativePath.split(/[\\/]/).includes('..') ||
      /[\x00-\x1f]/.test(spec.relativePath)
    ) {
      results.push({ relativePath: spec.relativePath, status: 'invalid-path', bytes: 0 })
      continue
    }

    const candidate = path.resolve(resolvedBase, spec.relativePath)
    if (!candidate.startsWith(resolvedBase + path.sep)) {
      results.push({ relativePath: spec.relativePath, status: 'invalid-path', bytes: 0 })
      continue
    }

    let lstat: Awaited<ReturnType<typeof fs.lstat>>
    try {
      lstat = await fs.lstat(candidate)
    } catch {
      results.push({ relativePath: spec.relativePath, status: 'missing', bytes: 0 })
      continue
    }

    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      results.push({ relativePath: spec.relativePath, status: 'invalid-path', bytes: 0 })
      continue
    }

    const realCandidate = await fs.realpath(candidate)
    if (!realCandidate.startsWith(realBase + path.sep)) {
      results.push({ relativePath: spec.relativePath, status: 'invalid-path', bytes: 0 })
      continue
    }

    if (lstat.size < Math.max(1, spec.minBytes)) {
      results.push({ relativePath: spec.relativePath, status: 'empty', bytes: lstat.size })
      continue
    }

    if (!spec.expectedSha256) {
      results.push({ relativePath: spec.relativePath, status: 'present-unpinned', bytes: lstat.size })
      continue
    }

    const actualSha256 = await sha256File(realCandidate)
    const ok = actualSha256.toLowerCase() === spec.expectedSha256.toLowerCase()
    results.push({
      relativePath: spec.relativePath,
      status: ok ? 'verified' : 'hash-mismatch',
      bytes: lstat.size,
      actualSha256,
    })
  }
  return results
}
