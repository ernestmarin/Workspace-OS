import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

export interface KokoroFilesStatus {
  projectDir: string
  wrapper: boolean
  project: boolean
  environment: boolean
  model: boolean
  voices: boolean
}

async function isFile(file: string): Promise<boolean> {
  try { const stat = await fs.stat(file); return stat.isFile() && stat.size > 0 } catch { return false }
}

/** Existence checks only: they do not prove the environment or model can synthesize. */
export async function kokoroFilesStatus(engineRoot: string): Promise<KokoroFilesStatus> {
  const projectDir = path.join(engineRoot, 'kokoro')
  const [wrapper, project, environment, model, voices] = await Promise.all([
    isFile(path.join(projectDir, 'scripts', 'copyspeech-kokoro.py')),
    isFile(path.join(projectDir, 'pyproject.toml')),
    isFile(path.join(projectDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')),
    isFile(path.join(projectDir, 'models', 'kokoro-v1.0-duration.onnx')),
    isFile(path.join(projectDir, 'models', 'voices-v1.0.bin')),
  ])
  return { projectDir, wrapper, project, environment, model, voices }
}

/** Stage bundled files only. Never overwrite user files, install packages, or download models. */
export async function prepareKokoro(engineRoot: string, resourceDir: string): Promise<KokoroFilesStatus> {
  const projectDir = path.join(engineRoot, 'kokoro')
  await fs.mkdir(path.join(projectDir, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(projectDir, 'models'), { recursive: true })
  for (const [src, dest] of [
    ['copyspeech-kokoro.py', path.join(projectDir, 'scripts', 'copyspeech-kokoro.py')],
    ['pyproject.toml', path.join(projectDir, 'pyproject.toml')],
  ]) {
    try { await fs.copyFile(path.join(resourceDir, src), dest, constants.COPYFILE_EXCL) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return kokoroFilesStatus(engineRoot)
}
