import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { trash } from '../trash'
import { IpcValidationError } from '../ipc-validator'
import { assertMainWindowFrame } from '../main-window'
import { IPC } from '../ipc-channels'

function assertId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) {
    throw new IpcValidationError('Invalid trash entry id')
  }
  return id
}

export function registerTrashHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.TRASH_LIST, (event) => {
    assertMainWindowFrame(event)
    return trash.list()
  })
  ipcHandle(ipcMain, IPC.TRASH_RESTORE, (event, id: unknown) => {
    assertMainWindowFrame(event)
    return trash.restore(assertId(id))
  })
  ipcHandle(ipcMain, IPC.TRASH_DELETE, (event, id: unknown) => {
    assertMainWindowFrame(event)
    return trash.deleteEntry(assertId(id))
  })
  ipcHandle(ipcMain, IPC.TRASH_EMPTY, (event) => {
    assertMainWindowFrame(event)
    return trash.empty()
  })
}
