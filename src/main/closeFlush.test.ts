import { expect, it, vi } from 'vitest'
import { createCloseHandler } from './closeFlush'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(quitting: boolean) {
  let done: (() => void) | null = null
  let timeoutCb: (() => void) | null = null
  const deps = {
    requestFlush: vi.fn(),
    onFlushDone: vi.fn((cb: () => void) => {
      done = cb
      return () => {
        done = null
      }
    }),
    setTimer: vi.fn((cb: () => void) => {
      timeoutCb = cb
      return () => {
        timeoutCb = null
      }
    }),
    closeWindow: vi.fn(),
    quitApp: vi.fn(),
    isQuitting: () => quitting
  }
  const handler = createCloseHandler(deps)
  return { deps, handler, fire: () => done?.(), fireTimeout: () => timeoutCb?.() }
}

it('prevents the first close, flushes, then closes', () => {
  const { deps, handler, fire } = setup(false)
  const ev = { preventDefault: vi.fn() }
  handler(ev)
  expect(ev.preventDefault).toHaveBeenCalled()
  expect(deps.requestFlush).toHaveBeenCalledTimes(1)
  expect(deps.closeWindow).not.toHaveBeenCalled()
  fire()
  expect(deps.closeWindow).toHaveBeenCalledTimes(1)
  expect(deps.quitApp).not.toHaveBeenCalled()
})

it('re-issues quit after flush when quitting', () => {
  const { deps, handler, fire } = setup(true)
  handler({ preventDefault: vi.fn() })
  fire()
  expect(deps.closeWindow).toHaveBeenCalledTimes(1)
  expect(deps.quitApp).toHaveBeenCalledTimes(1)
})

it('a second close does not re-run the handshake', () => {
  const { deps, handler, fire } = setup(false)
  handler({ preventDefault: vi.fn() })
  fire()
  const ev = { preventDefault: vi.fn() }
  handler(ev)
  expect(ev.preventDefault).not.toHaveBeenCalled()
  expect(deps.requestFlush).toHaveBeenCalledTimes(1)
})

it('closes after timeout if the renderer never replies', () => {
  const { deps, handler, fireTimeout } = setup(false)
  handler({ preventDefault: vi.fn() })
  fireTimeout()
  expect(deps.closeWindow).toHaveBeenCalledTimes(1)
})
