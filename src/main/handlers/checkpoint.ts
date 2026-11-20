import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { checkpoints } from '../checkpoint'
import { IpcValidationError } from '../ipc-validator'
import { IPC } from '../ipc-channels'

function assertSha(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{7,40}$/.test(id)) {
    throw new IpcValidationError('Invalid checkpoint id')
  }
  return id
}

export function registerCheckpointHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.CHECKPOINT_LIST, () => checkpoints.list())
  ipcHandle(ipcMain, IPC.CHECKPOINT_ROLLBACK, (_event, id: unknown) => checkpoints.rollbackTo(assertSha(id)))
  ipcHandle(ipcMain, IPC.CHECKPOINT_DIFF, (_event, id: unknown) => checkpoints.diffSince(assertSha(id)))
}
