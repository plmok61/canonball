// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SettingsDialog } from './SettingsDialog'
import type { AiStatus, ModelList } from '../../../shared/ai'

const status = (over: Partial<AiStatus> = {}): AiStatus => ({
  keys: { anthropic: false, openai: false, google: false },
  localUrl: null,
  model: null,
  encryptionAvailable: true,
  ...over
})

function stub(
  s: AiStatus,
  list: ModelList = { models: [], errors: [] },
  over: Record<string, unknown> = {}
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    getAiStatus: vi.fn().mockResolvedValue(s),
    setApiKey: vi.fn().mockResolvedValue(s),
    setLocalUrl: vi.fn().mockResolvedValue(s),
    listModels: vi.fn().mockResolvedValue(list),
    ...over
  }
  ;(window as unknown as { canonball: object }).canonball = api
  return api as Record<string, ReturnType<typeof vi.fn>>
}

afterEach(cleanup)

function section(label: string): HTMLElement {
  return screen.getByRole('heading', { name: label }).closest('section') as HTMLElement
}

it('shows which keys are saved without showing them', async () => {
  stub(status({ keys: { anthropic: false, openai: true, google: false } }))
  render(<SettingsDialog onClose={vi.fn()} onChanged={vi.fn()} />)
  expect(await screen.findByText('Saved in Keychain')).toBeInTheDocument()
  expect(within(section('OpenAI')).getByText('Saved in Keychain')).toBeInTheDocument()
  expect(within(section('Anthropic')).getByText('Not set')).toBeInTheDocument()
  expect(screen.getByLabelText('OpenAI API key')).toHaveValue('')
})

it('saving a key calls setApiKey and clears the input', async () => {
  const api = stub(status())
  const onChanged = vi.fn()
  render(<SettingsDialog onClose={vi.fn()} onChanged={onChanged} />)
  const input = await screen.findByLabelText('OpenAI API key')
  fireEvent.change(input, { target: { value: 'sk-secret' } })
  fireEvent.click(within(section('OpenAI')).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.setApiKey).toHaveBeenCalledWith('openai', 'sk-secret'))
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  expect(input).toHaveValue('')
})

it('Remove clears the key', async () => {
  const api = stub(status({ keys: { anthropic: false, openai: true, google: false } }))
  const onChanged = vi.fn()
  render(<SettingsDialog onClose={vi.fn()} onChanged={onChanged} />)
  await screen.findByText('Saved in Keychain')
  fireEvent.click(within(section('OpenAI')).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(api.setApiKey).toHaveBeenCalledWith('openai', null))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
})

it('shows a save error', async () => {
  stub(status(), undefined, {
    setLocalUrl: vi
      .fn()
      .mockRejectedValue(new Error('Enter a URL starting with http:// or https://'))
  })
  const onChanged = vi.fn()
  render(<SettingsDialog onClose={vi.fn()} onChanged={onChanged} />)
  fireEvent.change(await screen.findByLabelText('Local server URL'), { target: { value: 'nope' } })
  fireEvent.click(within(section('Local server')).getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Enter a URL starting with http:// or https://'
  )
  expect(onChanged).not.toHaveBeenCalled()
})

it('lists the connection check', async () => {
  stub(status(), {
    models: [
      { provider: 'openai', model: 'gpt-a', label: 'A' },
      { provider: 'openai', model: 'gpt-b', label: 'B' }
    ],
    errors: [
      {
        provider: 'local',
        message: "Couldn't reach the local server at http://x/v1. Is it running?"
      }
    ]
  })
  render(<SettingsDialog onClose={vi.fn()} onChanged={vi.fn()} />)
  expect(await screen.findByText('OpenAI: 2 models')).toBeInTheDocument()
  expect(screen.getByText(/Local server: Couldn't reach/)).toBeInTheDocument()
})

it('disables keys when the Keychain is unavailable', async () => {
  stub(status({ encryptionAvailable: false }))
  render(<SettingsDialog onClose={vi.fn()} onChanged={vi.fn()} />)
  expect(
    await screen.findByText("This Mac's Keychain isn't available, so API keys can't be saved.")
  ).toBeInTheDocument()
  expect(screen.getByLabelText('OpenAI API key')).toBeDisabled()
})

it('Done and Escape close the dialog', async () => {
  stub(status())
  const onClose = vi.fn()
  render(<SettingsDialog onClose={onClose} onChanged={vi.fn()} />)
  const dialog = await screen.findByRole('dialog', { name: 'AI connections' })
  fireEvent.keyDown(dialog, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
