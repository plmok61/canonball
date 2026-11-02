import { expect, it } from 'vitest'
import { cleanIpcError, cleanIpcMessage } from './ipcError'

it('strips the Electron invoke prefix and the remote error name', () => {
  expect(
    cleanIpcMessage(
      "Error invoking remote method 'canonball:setApiKey': Error: That doesn't look like an API key."
    )
  ).toBe("That doesn't look like an API key.")
  expect(
    cleanIpcMessage("Error invoking remote method 'canonball:startChat': TypeError: Bad request")
  ).toBe('Bad request')
  expect(cleanIpcMessage("Error invoking remote method 'canonball:loadChat': Chat not found")).toBe(
    'Chat not found'
  )
})

it('leaves other messages alone', () => {
  expect(cleanIpcMessage('Chat not found')).toBe('Chat not found')
  expect(cleanIpcMessage('Error: keep me')).toBe('Error: keep me')
})

it('turns any rejection into an Error with a clean message', () => {
  const e = cleanIpcError(
    new Error("Error invoking remote method 'canonball:saveChat': Error: Chat file is unreadable")
  )
  expect(e).toBeInstanceOf(Error)
  expect(e.message).toBe('Chat file is unreadable')
  expect(cleanIpcError('plain').message).toBe('plain')
})
