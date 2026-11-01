// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SessionBanner } from './SessionBanner'

afterEach(cleanup)

it('shows the goal and End session', () => {
  const onEnd = vi.fn()
  render(<SessionBanner session={{ goal: 'the ship' }} canEnd onEnd={onEnd} />)
  const banner = screen.getByRole('status')
  expect(banner).toHaveTextContent('Brainstorm: the ship')
  expect(banner).not.toHaveTextContent('Ended')
  fireEvent.click(within(banner).getByRole('button', { name: 'End session' }))
  expect(onEnd).toHaveBeenCalledTimes(1)
})

it('End session is disabled when it cannot send', () => {
  render(<SessionBanner session={{ goal: 'the ship' }} canEnd={false} onEnd={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'End session' })).toBeDisabled()
})

it('an ended session shows Ended and no button', () => {
  render(
    <SessionBanner
      session={{ goal: 'the ship', endedAt: '2026-11-01T00:00:00.000Z' }}
      canEnd
      onEnd={vi.fn()}
    />
  )
  expect(screen.getByRole('status')).toHaveTextContent('Brainstorm: the ship · Ended')
  expect(screen.queryByRole('button')).toBeNull()
})
