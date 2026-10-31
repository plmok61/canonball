import { expect, it, vi } from 'vitest'
import { createCloseHandler, type FlushResult } from './closeFlush'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(quitting: boolean, quitAnyway = false) {
  let done: ((r: FlushResult) => void) | null = null
  let timeoutCb: (() => void) | null = null
  let isQuitting = quitting
  const deps = {
    requestFlush: vi.fn(),
    onFlushDone: vi.fn((cb: (r: FlushResult) => void) => {
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
    confirmQuitAnyway: vi.fn(async (_detail: string) => quitAnyway),
    closeWindow: vi.fn(),
    quitApp: vi.fn(),
    isQuitting: () => isQuitting,
    cancelQuit: vi.fn(() => {
      isQuitting = false
    })
  }
  const handler = createCloseHandler(deps)
  return {
    deps,
    handler,
    fire: (r: FlushResult = { ok: true }) => done?.(r),
    fireTimeout: () => timeoutCb?.()
  }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

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
  expect(deps.confirmQuitAnyway).not.toHaveBeenCalled()
})

it('re-issues quit after flush when quitting', () => {
  const { deps, handler, fire } = setup(true)
  handler({ preventDefault: vi.fn() })
  fire()
  expect(deps.closeWindow).toHaveBeenCalledTimes(1)
  expect(deps.quitApp).toHaveBeenCalledTimes(1)
})

it('the close it issues itself is let through without another handshake', () => {
  const { deps, handler, fire } = setup(false)
  handler({ preventDefault: vi.fn() })
  fire()
  const ev = { preventDefault: vi.fn() }
  handler(ev)
  expect(ev.preventDefault).not.toHaveBeenCalled()
  expect(deps.requestFlush).toHaveBeenCalledTimes(1)
})

it('a second close while the flush is running is held, not let through', () => {
  const { deps, handler } = setup(false)
  handler({ preventDefault: vi.fn() })
  const ev = { preventDefault: vi.fn() }
  handler(ev)
  expect(ev.preventDefault).toHaveBeenCalled()
  expect(deps.requestFlush).toHaveBeenCalledTimes(1)
})

it('failed flush + Cancel keeps the window open and lets a later close retry', async () => {
  const { deps, handler, fire } = setup(true, false)
  handler({ preventDefault: vi.fn() })
  fire({ ok: false, error: 'disk full' })
  await settle()
  expect(deps.confirmQuitAnyway).toHaveBeenCalledWith('disk full')
  expect(deps.closeWindow).not.toHaveBeenCalled()
  expect(deps.quitApp).not.toHaveBeenCalled()
  expect(deps.cancelQuit).toHaveBeenCalledTimes(1)
  const ev = { preventDefault: vi.fn() }
  handler(ev)
  expect(ev.preventDefault).toHaveBeenCalled()
  expect(deps.requestFlush).toHaveBeenCalledTimes(2)
  fire()
  expect(deps.closeWindow).toHaveBeenCalledTimes(1)
})

it('failed flush + Quit Anyway closes and re-issues quit when quitting', async () => {
  const { deps, handler, fire } = setup(true, true)
  handler({ preventDefault: vi.fn() })
  fire({ ok: false, error: 'disk full' })
  await settle()
  expect(deps.closeWindow).toHaveBeenCalledTimes(1)
  expect(deps.quitApp).toHaveBeenCalledTimes(1)
  expect(deps.cancelQuit).not.toHaveBeenCalled()
})

it('failed flush + Quit Anyway closes without quitting when only closing', async () => {
  const { deps, handler, fire } = setup(false, true)
  handler({ preventDefault: vi.fn() })
  fire({ ok: false, error: 'disk full' })
  await settle()
  expect(deps.closeWindow).toHaveBeenCalledTimes(1)
  expect(deps.quitApp).not.toHaveBeenCalled()
})

it('timeout asks like a failure, with the slow-save message', async () => {
  const { deps, handler, fireTimeout, fire } = setup(true, false)
  handler({ preventDefault: vi.fn() })
  fireTimeout()
  await settle()
  expect(deps.confirmQuitAnyway).toHaveBeenCalledWith('Saving is taking longer than expected.')
  expect(deps.closeWindow).not.toHaveBeenCalled()
  expect(deps.cancelQuit).toHaveBeenCalledTimes(1)
  // a late reply from the abandoned handshake changes nothing
  fire()
  expect(deps.closeWindow).not.toHaveBeenCalled()
})

it('timeout + Quit Anyway closes', async () => {
  const { deps, handler, fireTimeout } = setup(false, true)
  handler({ preventDefault: vi.fn() })
  fireTimeout()
  await settle()
  expect(deps.closeWindow).toHaveBeenCalledTimes(1)
})
