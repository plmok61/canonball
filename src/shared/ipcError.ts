/**
 * Electron wraps errors thrown by an `ipcMain.handle` handler as
 * `Error invoking remote method '<channel>': Error: <message>`. Writers should
 * only ever see `<message>`.
 */
const IPC_PREFIX = /^Error invoking remote method '[^']+': (?:\w*Error: )?/

export function cleanIpcMessage(message: string): string {
  return message.replace(IPC_PREFIX, '')
}

export function cleanIpcError(e: unknown): Error {
  return new Error(cleanIpcMessage(e instanceof Error ? e.message : String(e)))
}
