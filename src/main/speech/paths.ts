/**
 * Locations for everything the Voice feature persists, under
 * `userData/copyspeech/`. Local-first plain files, like the rest of the app;
 * secrets are NOT here (they live in the keychain vault).
 */
import path from 'path'
import fs from 'fs'
import { userDataDir } from '../userdata-path'

export function speechDataDir(): string {
  return path.join(userDataDir(), 'copyspeech')
}
export function speechConfigPath(): string {
  return path.join(speechDataDir(), 'config.json')
}
export function speechHistoryPath(): string {
  return path.join(speechDataDir(), 'history.json')
}
/** Rendered/cached audio clips (re-synthesis cache + history attachments). */
export function speechClipsDir(): string {
  return path.join(speechDataDir(), 'clips')
}
/** Local engine wrappers managed by `uv` install into this directory. */
export function speechEnginesDir(): string {
  return path.join(speechDataDir(), 'engines')
}

export function ensureSpeechDirs(): void {
  fs.mkdirSync(speechClipsDir(), { recursive: true })
  fs.mkdirSync(speechEnginesDir(), { recursive: true })
}
