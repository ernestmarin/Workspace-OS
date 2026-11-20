import path from 'node:path'
import {
  REVIEWED_SPEECH_MODELS,
  SPEECH_MODEL_MANIFEST_VERSION,
  type SpeechModelManifestEntry,
} from '../../shared/speech/modelManifest'
import {
  verifyModelArtifacts,
  type ArtifactVerificationResult,
  type ArtifactVerificationStatus,
} from './modelVerifier'

/**
 * Turn artifact-level verification into the four states a user can act on
 * (VOX-A4c).
 *
 * `verifyModelArtifacts` answers "what is on disk"; Voice Settings needs the
 * question a person actually asks: *may I rely on this model right now, and if
 * not, what do I do?* Keeping that mapping here — pure, no fs, no Electron —
 * is what makes it testable, and it is the place the honesty rule is enforced:
 *
 *   file present  !=  ready
 *
 * A model is `verified_offline` only when EVERY artifact matched a pinned
 * SHA-256. Models whose reviewed entries carry no pin at all (the bundled Kokoro
 * wrapper, the user-provisioned Whisper and Piper weights) can never reach that
 * state — they report `unverified_files_present`, which is the truthful answer:
 * the bytes are there and nothing about them has been checked cryptographically.
 */
export type ModelReadiness =
  | 'missing'
  | 'unverified_files_present'
  | 'corrupt'
  | 'verified_offline'
  /**
   * The directory sits outside the approved root, or a path escapes it. Not a
   * user-fixable model problem: it is a refusal, and it is reported as one.
   */
  | 'invalid_location'

/** A specific, non-destructive recovery step. Never deletes or downloads. */
export interface ModelRecoveryHint {
  code:
    | 'provision-files'
    | 'reinstall-bundled'
    | 'replace-corrupt-artifact'
    | 'fix-model-directory'
  /** Short imperative sentence for the UI. */
  message: string
  /** The artifacts to place, when the state is fixable by provision. */
  files?: string[]
}

export interface SpeechModelDiagnostic {
  id: SpeechModelManifestEntry['id']
  label: string
  role: SpeechModelManifestEntry['role']
  license: SpeechModelManifestEntry['license']
  notes: string
  /** Absolute directory the artifacts are resolved against. */
  modelDir: string
  readiness: ModelReadiness
  /** Honest counts: an artifact present is not an artifact verified. */
  counts: {
    artifacts: number
    present: number
    verified: number
    unverified: number
    corrupt: number
    missing: number
    invalid: number
  }
  artifacts: ArtifactVerificationResult[]
  recovery: ModelRecoveryHint[]
  /**
   * True only for `verified_offline`. This is the single field a UI may use to
   * enable a local engine, so "ready" can never be inferred from file existence.
   */
  ready: boolean
}

const MISSING_LIKE: readonly ArtifactVerificationStatus[] = ['missing', 'empty']

/**
 * Classify one model from its artifact results. Pure: no filesystem, no policy
 * of its own — the caller decides which directory to verify.
 */
export function classifyModelReadiness(
  artifacts: readonly ArtifactVerificationResult[],
): ModelReadiness {
  if (artifacts.length === 0) return 'missing'
  if (artifacts.some((a) => a.status === 'invalid-path')) return 'invalid_location'
  if (artifacts.some((a) => a.status === 'hash-mismatch')) return 'corrupt'
  if (artifacts.every((a) => MISSING_LIKE.includes(a.status))) return 'missing'
  if (artifacts.some((a) => MISSING_LIKE.includes(a.status))) return 'missing'
  // Everything is on disk and non-empty. Only a pinned hash can promote that to
  // verified; an unpinned artifact is exactly the "unverified files present"
  // case that must never be labelled ready.
  return artifacts.every((a) => a.status === 'verified')
    ? 'verified_offline'
    : 'unverified_files_present'
}

/** The act-on-it guidance for a state. Deterministic, and never destructive. */
export function recoveryHints(
  readiness: ModelReadiness,
  artifacts: readonly ArtifactVerificationResult[],
  extraMissing: readonly string[] = [],
): ModelRecoveryHint[] {
  const missingFiles = [
    ...artifacts.filter((a) => MISSING_LIKE.includes(a.status)).map((a) => a.relativePath),
    ...extraMissing,
  ]
  const corruptFiles = artifacts.filter((a) => a.status === 'hash-mismatch')
  switch (readiness) {
    case 'missing':
      return [
        {
          code: 'provision-files',
          message:
            missingFiles.length > 0
              ? `Place these files in the model directory — nothing is downloaded automatically: ${missingFiles.join(', ')}`
              : 'Place the model files in the directory — nothing is downloaded automatically.',
          files: missingFiles,
        },
      ]
    case 'corrupt':
      return [
        {
          code: 'replace-corrupt-artifact',
          message: `These files do not match their recorded checksum and must be replaced: ${corruptFiles
            .map((a) => a.relativePath)
            .join(', ')}`,
          files: corruptFiles.map((a) => a.relativePath),
        },
      ]
    case 'invalid_location':
      return [
        {
          code: 'fix-model-directory',
          message:
            'A model file lies outside the approved model directory, or is a symbolic link. Move the real files into the directory itself.',
        },
      ]
    case 'unverified_files_present':
      return [
        {
          code: 'reinstall-bundled',
          message:
            'The files are present but nothing about them has been verified. Local speech stays off until a reviewed checksum matches.',
        },
      ]
    case 'verified_offline':
      return []
  }
}

/** Assemble one diagnostic from verified artifacts plus the model's metadata. */
export function buildModelDiagnostic(
  entry: SpeechModelManifestEntry,
  modelDir: string,
  artifacts: readonly ArtifactVerificationResult[],
  extraMissing: readonly string[] = [],
): SpeechModelDiagnostic {
  const readiness = classifyModelReadiness(artifacts)
  const counts = {
    artifacts: artifacts.length,
    present: artifacts.filter((a) => !MISSING_LIKE.includes(a.status) && a.status !== 'invalid-path').length,
    verified: artifacts.filter((a) => a.status === 'verified').length,
    unverified: artifacts.filter((a) => a.status === 'present-unpinned').length,
    corrupt: artifacts.filter((a) => a.status === 'hash-mismatch').length,
    missing: artifacts.filter((a) => MISSING_LIKE.includes(a.status)).length,
    invalid: artifacts.filter((a) => a.status === 'invalid-path').length,
  }
  return {
    id: entry.id,
    label: entry.label,
    role: entry.role,
    license: entry.license,
    notes: entry.notes,
    modelDir,
    readiness,
    counts,
    artifacts: [...artifacts],
    recovery: recoveryHints(readiness, artifacts, extraMissing),
    // The one field that may gate an engine. Present files are NOT readiness.
    ready: readiness === 'verified_offline',
  }
}

export interface SpeechModelDiagnosticsReport {
  manifestVersion: number
  /** When this snapshot was taken (ISO). Verification is I/O, never cached forever. */
  checkedAt: string
  models: SpeechModelDiagnostic[]
}

/**
 * Verify every reviewed model against one root directory.
 *
 * `resolveDir` maps a manifest entry to its directory (Kokoro and Piper live
 * under the speech engine root; Whisper has its own). Any failure to read a
 * directory is reported as `missing` rather than thrown: a diagnostics surface
 * that refuses to render because a folder is absent is useless exactly when it
 * is needed.
 */
export async function verifyReviewedSpeechModels(
  resolveDir: (entry: SpeechModelManifestEntry) => string,
  manifest: readonly SpeechModelManifestEntry[] = REVIEWED_SPEECH_MODELS,
  now: () => Date = () => new Date(),
): Promise<SpeechModelDiagnosticsReport> {
  const models: SpeechModelDiagnostic[] = []
  for (const entry of manifest) {
    const dir = resolveDir(entry)
    let artifacts: ArtifactVerificationResult[] = []
    try {
      artifacts = await verifyModelArtifacts(dir, entry.artifacts)
    } catch {
      artifacts = entry.artifacts.map((a) => ({
        relativePath: a.relativePath,
        status: 'missing' as const,
        bytes: 0,
      }))
    }
    models.push(buildModelDiagnostic(entry, dir, artifacts))
  }
  return {
    manifestVersion: SPEECH_MODEL_MANIFEST_VERSION,
    checkedAt: now().toISOString(),
    models,
  }
}

/** The directory a model's artifacts are resolved against, under one engine root. */
export function modelDirFor(entry: SpeechModelManifestEntry, engineRoot: string, sttRoot: string): string {
  if (entry.role === 'stt') return path.resolve(sttRoot)
  return path.resolve(engineRoot)
}
