// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ThemePicker } from './ThemePicker'

afterEach(cleanup)

it('offers exactly Light, Dark, Match System and reports the choice', () => {
  const onChange = vi.fn()
  render(<ThemePicker value="system" onChange={onChange} />)
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
    'Light',
    'Dark',
    'Match System'
  ])
  expect(screen.getByRole('button', { name: 'Match System' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
  expect(onChange).toHaveBeenCalledWith('dark')
})
