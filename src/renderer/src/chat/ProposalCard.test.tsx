// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ProposalCard } from './ProposalCard'
import { EXPIRED_PROPOSAL, type Proposal } from '../../../shared/proposals'

afterEach(cleanup)

const edit = (over: Partial<Proposal> = {}): Proposal => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'edit',
  relPath: 'notes/ideas.md',
  before: 'one\ntwo\nold line\nfour\n',
  after: 'one\ntwo\nnew line\nfour\n',
  status: 'pending',
  ...over
})

const noop = (): void => {}

it('shows the file without .md and the added and removed lines', () => {
  render(<ProposalCard proposal={edit()} onAccept={noop} onReject={noop} busy={false} />)
  const card = screen.getByRole('group', { name: 'Suggested edit to notes/ideas' })
  expect(within(card).getByRole('heading')).toHaveTextContent('Edit notes/ideas')
  expect(card.querySelector('del')).toHaveTextContent('old line')
  expect(card.querySelector('ins')).toHaveTextContent('new line')
  expect(card).toHaveTextContent('two')
  expect(card.textContent).not.toContain('.md')
})

it('collapses unchanged runs into a gap', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n')
  const after = ['a', 'b', 'c', 'd', 'e', 'f', 'G'].join('\n')
  render(
    <ProposalCard proposal={edit({ before, after })} onAccept={noop} onReject={noop} busy={false} />
  )
  const card = screen.getByRole('group', { name: 'Suggested edit to notes/ideas' })
  const rows = [...card.querySelectorAll('.cb-diff > *')].map((r) => r.textContent)
  expect(rows).toEqual(['…', 'e', 'f', 'g', 'G'])
})

it('a new file shows only added lines', () => {
  render(
    <ProposalCard
      proposal={edit({ kind: 'create', relPath: 'notes/new.md', before: '', after: 'x\ny' })}
      onAccept={noop}
      onReject={noop}
      busy={false}
    />
  )
  const card = screen.getByRole('group', { name: 'Suggested new file notes/new' })
  expect(within(card).getByRole('heading')).toHaveTextContent('New file notes/new')
  expect(card.querySelectorAll('ins')).toHaveLength(2)
  expect(card.querySelector('del')).toBeNull()
})

it('Accept and Reject call back', () => {
  const onAccept = vi.fn()
  const onReject = vi.fn()
  render(<ProposalCard proposal={edit()} onAccept={onAccept} onReject={onReject} busy={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
  expect(onAccept).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
  expect(onReject).toHaveBeenCalledTimes(1)
})

it('both buttons are disabled while busy', () => {
  render(<ProposalCard proposal={edit()} onAccept={noop} onReject={noop} busy />)
  expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
})

it('shows the outcome instead of buttons once decided', () => {
  const { rerender } = render(
    <ProposalCard
      proposal={edit({ status: 'accepted' })}
      onAccept={noop}
      onReject={noop}
      busy={false}
    />
  )
  expect(screen.getByText('Accepted')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
  rerender(
    <ProposalCard
      proposal={edit({ status: 'rejected' })}
      onAccept={noop}
      onReject={noop}
      busy={false}
    />
  )
  expect(screen.getByText('Rejected')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})

it('an expired proposal shows its error', () => {
  render(
    <ProposalCard
      proposal={edit({ status: 'failed', error: EXPIRED_PROPOSAL })}
      onAccept={noop}
      onReject={noop}
      busy={false}
    />
  )
  expect(screen.getByRole('alert')).toHaveTextContent(EXPIRED_PROPOSAL)
  expect(screen.queryByRole('button')).toBeNull()
})
