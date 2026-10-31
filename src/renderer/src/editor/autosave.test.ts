import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { Autosave } from './autosave'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function make(initial = 'start'): { save: Mock; auto: Autosave } {
  const save = vi.fn().mockResolvedValue(undefined)
  return { save, auto: new Autosave({ delayMs: 800, save, initial }) }
}

it('saves once after 800ms of quiet', async () => {
  const { save, auto } = make()
  auto.change('a')
  await vi.advanceTimersByTimeAsync(700)
  auto.change('ab')
  await vi.advanceTimersByTimeAsync(700)
  expect(save).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(200)
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith('ab')
})

it('does not save when content equals last saved', async () => {
  const { save, auto } = make('same')
  auto.change('same')
  expect(auto.dirty).toBe(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect(save).not.toHaveBeenCalled()
})

it('flush saves pending content immediately', async () => {
  const { save, auto } = make()
  auto.change('x')
  await auto.flush()
  expect(save).toHaveBeenCalledWith('x')
  await vi.advanceTimersByTimeAsync(2000)
  expect(save).toHaveBeenCalledTimes(1)
})

it('dirty is false after save resolves', async () => {
  const { auto } = make()
  auto.change('x')
  expect(auto.dirty).toBe(true)
  await auto.flush()
  expect(auto.dirty).toBe(false)
})

it('cancels the pending save when content returns to the last saved text', async () => {
  const { save, auto } = make('start')
  auto.change('x')
  auto.change('start')
  expect(auto.dirty).toBe(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect(save).not.toHaveBeenCalled()
})
