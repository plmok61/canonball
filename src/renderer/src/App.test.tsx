// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from './App'

function stub(lastProjectRoot: string | null, newProjectDialog = vi.fn()): void {
  const info = { root: '/p', name: 'p', tree: [] }
  ;(window as unknown as { canonball: object }).canonball = {
    getSettings: vi.fn().mockResolvedValue({ lastProjectRoot, theme: 'system' }),
    openProject: vi.fn().mockResolvedValue(info),
    openProjectDialog: vi.fn(),
    newProjectDialog
  }
}

afterEach(cleanup)

it('renders tree, editor and chat panels', async () => {
  stub('/p')
  render(<App />)
  expect(await screen.findByTestId('tree-panel')).toBeInTheDocument()
  expect(screen.getByTestId('editor-panel')).toBeInTheDocument()
  expect(screen.getByTestId('chat-panel')).toHaveTextContent('AI chat arrives in a later phase')
})

it('shows welcome screen when no last project', async () => {
  stub(null)
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Open Project…' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'New Project…' })).toBeInTheDocument()
  expect(screen.queryByTestId('tree-panel')).toBeNull()
})

it('shows an error when creating a project fails', async () => {
  stub(null, vi.fn().mockRejectedValue(new Error('Folder is not empty')))
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'New Project…' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Folder is not empty')
  expect(screen.getByRole('button', { name: 'New Project…' })).toBeEnabled()
})
