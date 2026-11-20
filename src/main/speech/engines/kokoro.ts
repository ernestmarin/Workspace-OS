import { statSync } from 'node:fs'
import path from 'node:path'

/**
 * Check default local prerequisites before uv can create/repair an environment.
 * Nonempty files only: this does NOT verify integrity, executable/model compatibility
 * or synthesis readiness. Those require a separate, explicit runtime check.
 */
export function assertKokoroInstalled(engineDir: string): void {
  const project = path.join(engineDir, 'kokoro')
  const required = ['scripts/copyspeech-kokoro.py', 'pyproject.toml',
    `.venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`,
    'models/kokoro-v1.0-duration.onnx', 'models/voices-v1.0.bin']
  const present = required.every((name) => {
    try { const stat = statSync(path.join(project, name)); return stat.isFile() && stat.size > 0 } catch { return false }
  })
  if (!present) throw new Error('Kokoro is not installed completely. Prepare the project, explicitly install Python dependencies and provide both model files in Voice settings. File presence is not synthesis readiness.')
}
