// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SessionStart } from './SessionStart'
import { SESSION_GOAL_MAX } from '../../../shared/ai'

afterEach(cleanup)

const goalBox = (): HTMLElement => screen.getByLabelText('What do you want to figure out?')

it('starts with the trimmed goal', () => {
  const onStart = vi.fn()
  render(<SessionStart canStart onStart={onStart} onCancel={vi.fn()} />)
  expect(screen.getByRole('form', { name: 'Start a brainstorm session' })).toBeInTheDocument()
  expect(goalBox()).toHaveFocus()
  expect(goalBox()).toHaveAttribute('maxLength', String(SESSION_GOAL_MAX))
  fireEvent.change(goalBox(), { target: { value: '  the ship  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
  expect(onStart).toHaveBeenCalledWith('the ship')
  onStart.mockClear()
  fireEvent.keyDown(goalBox(), { key: 'Enter' })
  expect(onStart).toHaveBeenCalledWith('the ship')
})

it("Start is disabled for a blank goal or when it can't start", () => {
  const onStart = vi.fn()
  const { rerender } = render(<SessionStart canStart onStart={onStart} onCancel={vi.fn()} />)
  const start = screen.getByRole('button', { name: 'Start session' })
  expect(start).toBeDisabled()
  fireEvent.change(goalBox(), { target: { value: '   ' } })
  expect(start).toBeDisabled()
  fireEvent.keyDown(goalBox(), { key: 'Enter' })
  fireEvent.change(goalBox(), { target: { value: 'the ship' } })
  expect(start).toBeEnabled()
  rerender(<SessionStart canStart={false} onStart={onStart} onCancel={vi.fn()} />)
  expect(start).toBeDisabled()
  fireEvent.keyDown(goalBox(), { key: 'Enter' })
  expect(onStart).not.toHaveBeenCalled()
})

it('Escape cancels', () => {
  const onCancel = vi.fn()
  const onStart = vi.fn()
  render(<SessionStart canStart onStart={onStart} onCancel={onCancel} />)
  fireEvent.keyDown(goalBox(), { key: 'Escape' })
  expect(onCancel).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledTimes(2)
  expect(onStart).not.toHaveBeenCalled()
})
