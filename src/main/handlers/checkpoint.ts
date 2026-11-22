import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { checkpoints } from '../checkpoint'
import { assertMainWindowFrame } from '../main-window'
import { IpcValidationError } from '../ipc-validator'
import { IPC } from '../ipc-channels'

function assertSha(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{7,40}$/.test(id)) {
    throw new IpcValidationError('Invalid checkpoint id')
  }
  return id
}

export function registerCheckpointHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.CHECKPOINT_LIST, (event) => {
    assertMainWindowFrame(event)
    return checkpoints.list()
  })
  ipcHandle(ipcMain, IPC.CHECKPOINT_ROLLBACK, (event, id: unknown) => {
    assertMainWindowFrame(event)
    return checkpoints.rollbackTo(assertSha(id))
  })
  ipcHandle(ipcMain, IPC.CHECKPOINT_DIFF, (event, id: unknown) => {
    assertMainWindowFrame(event)
    return checkpoints.diffSince(assertSha(id))
  })
}
