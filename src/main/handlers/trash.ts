import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { trash } from '../trash'
import { IpcValidationError } from '../ipc-validator'
import { IPC } from '../ipc-channels'

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) {
    throw new IpcValidationError('Invalid trash entry id')
  }
  return id
}

export function registerTrashHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.TRASH_LIST, () => trash.list())
  ipcHandle(ipcMain, IPC.TRASH_RESTORE, (_event, id: unknown) => trash.restore(assertId(id)))
  ipcHandle(ipcMain, IPC.TRASH_DELETE, (_event, id: unknown) => trash.deleteEntry(assertId(id)))
  ipcHandle(ipcMain, IPC.TRASH_EMPTY, () => trash.empty())
}
