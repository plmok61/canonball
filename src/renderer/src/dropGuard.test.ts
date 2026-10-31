// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { guardDrops } from './dropGuard'

let undo: (() => void) | null = null
afterEach(() => {
  undo?.()
  undo = null
  document.body.innerHTML = ''
})

function fire(target: Element, type: 'dragover' | 'drop'): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true })
  target.dispatchEvent(ev)
  return ev
}

it('a drop that nothing handles never reaches the browser default (navigating to the file)', () => {
  undo = guardDrops(window)
  const outside = document.body.appendChild(document.createElement('div'))
  expect(fire(outside, 'dragover').defaultPrevented).toBe(true)
  expect(fire(outside, 'drop').defaultPrevented).toBe(true)
})

it('also guards drops over the editor that the editor did not handle', () => {
  undo = guardDrops(window)
  const editor = document.body.appendChild(document.createElement('div'))
  editor.contentEditable = 'true'
  expect(fire(editor, 'drop').defaultPrevented).toBe(true)
})

it('can be removed', () => {
  guardDrops(window)()
  const outside = document.body.appendChild(document.createElement('div'))
  expect(fire(outside, 'drop').defaultPrevented).toBe(false)
})
