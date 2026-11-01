// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { NameEditor } from './NameEditor'

afterEach(cleanup)

it('selects only the stem when renaming a file', () => {
  render(<NameEditor initial="ch.md" selectStem onSubmit={vi.fn()} onCancel={vi.fn()} />)
  const input = screen.getByRole('textbox') as HTMLInputElement
  expect(input.value).toBe('ch.md')
  expect(input.selectionStart).toBe(0)
  expect(input.selectionEnd).toBe(2)
})

it('shows a local name error without calling onSubmit', () => {
  const onSubmit = vi.fn()
  render(<NameEditor initial="" selectStem={false} onSubmit={onSubmit} onCancel={vi.fn()} />)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: 'a/b' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(screen.getByText("Names can't contain / or :.")).toBeInTheDocument()
  expect(onSubmit).not.toHaveBeenCalled()
})

it('shows an error returned by onSubmit and stays open', async () => {
  const onSubmit = vi.fn().mockResolvedValue('That name is taken.')
  render(<NameEditor initial="x" selectStem={false} onSubmit={onSubmit} onCancel={vi.fn()} />)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  await waitFor(() => expect(screen.getByText('That name is taken.')).toBeInTheDocument())
  expect(onSubmit).toHaveBeenCalledWith('x')
  expect(screen.getByRole('textbox')).toBeInTheDocument()
})

it('Escape cancels', () => {
  const onCancel = vi.fn()
  render(<NameEditor initial="x" selectStem={false} onSubmit={vi.fn()} onCancel={onCancel} />)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  expect(onCancel).toHaveBeenCalled()
})
