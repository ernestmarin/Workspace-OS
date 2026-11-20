import { parentPort } from 'node:worker_threads'

/** A short-lived worker: all model access is local; no implicit model download. */
parentPort?.once('message', async (msg: { samples: Float32Array; language: string; modelRoot: string }) => {
  try {
    const { env, pipeline } = await import('@huggingface/transformers')
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = msg.modelRoot
    const transcriber = await pipeline('automatic-speech-recognition', 'whisper', { local_files_only: true, dtype: 'q8' })
    const result = await transcriber(msg.samples, { language: msg.language, task: 'transcribe' })
    const text = Array.isArray(result) ? result.map((entry) => entry.text).join(' ') : result.text
    parentPort?.postMessage({ text })
  } catch {
    // Model paths, recognized speech and dependency errors are never logged or sent to renderer.
    parentPort?.postMessage({ error: true })
  }
})
