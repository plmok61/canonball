import { beforeEach, expect, it, vi } from 'vitest'
import type { CanonballApi } from '../shared/types'

const h = vi.hoisted(() => ({ invoke: vi.fn(), exposed: null as CanonballApi | null }))
const invoke = h.invoke

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: CanonballApi) => {
      h.exposed = api
    }
  },
  ipcRenderer: { invoke: h.invoke, on: vi.fn(), send: vi.fn(), removeListener: vi.fn() }
}))

let exposed: CanonballApi | null = null

beforeEach(async () => {
  invoke.mockReset()
  if (!h.exposed) await import('./index')
  exposed = h.exposed
})

it('rejects with the main-process message, without the IPC prefix', async () => {
  invoke.mockRejectedValue(
    new Error(
      "Error invoking remote method 'canonball:setApiKey': Error: That doesn't look like an API key."
    )
  )
  await expect(exposed!.setApiKey('openai', 'bad key')).rejects.toThrow(
    /^That doesn't look like an API key\.$/
  )
  expect(invoke).toHaveBeenCalledWith('canonball:setApiKey', 'openai', 'bad key')
})

it('passes results through', async () => {
  invoke.mockResolvedValue([])
  await expect(exposed!.listChats()).resolves.toEqual([])
  expect(invoke).toHaveBeenCalledWith('canonball:listChats')
})
