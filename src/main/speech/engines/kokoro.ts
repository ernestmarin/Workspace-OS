import { existsSync } from 'node:fs'
import path from 'node:path'

/** Fail explicitly before spawning when the configured local wrapper is absent. */
export function assertKokoroInstalled(engineDir: string): void {
  const wrapper = path.join(engineDir, 'kokoro', 'scripts', 'copyspeech-kokoro.py')
  if (!existsSync(wrapper)) {
    throw new Error('Kokoro is not installed. Install the local engine before selecting Kokoro, or choose OpenAI in Voice settings.')
  }
}
