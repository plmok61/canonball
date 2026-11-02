import { useMemo } from 'react'
import { collapseDiff, diffLines } from '../../../shared/diff'
import { displayPath, type Proposal } from '../../../shared/proposals'

interface Props {
  proposal: Proposal
  onAccept(): void
  onReject(): void
  /** While an Accept is in flight both buttons are disabled. */
  busy: boolean
}

export function ProposalCard({ proposal, onAccept, onReject, busy }: Props): React.JSX.Element {
  const { kind, relPath, before, after, status, error } = proposal
  const name = displayPath(relPath)
  const rows = useMemo(() => collapseDiff(diffLines(before, after)), [before, after])
  const label = kind === 'edit' ? `Suggested edit to ${name}` : `Suggested new file ${name}`
  const heading = kind === 'edit' ? `Edit ${name}` : `New file ${name}`

  return (
    <div role="group" aria-label={label} className="cb-proposal">
      <h4 className="cb-proposal-title">{heading}</h4>
      <div className="cb-diff">
        {rows.map((r, i) =>
          r.kind === 'gap' ? (
            <div key={i} className="cb-diff-gap">
              …
            </div>
          ) : r.kind === 'add' ? (
            <ins key={i} className="cb-diff-add">
              {r.text}
            </ins>
          ) : r.kind === 'del' ? (
            <del key={i} className="cb-diff-del">
              {r.text}
            </del>
          ) : (
            <div key={i} className="cb-diff-same">
              {r.text}
            </div>
          )
        )}
      </div>
      <div className="cb-proposal-footer">
        {status === 'pending' ? (
          <>
            <button type="button" disabled={busy} onClick={onAccept}>
              Accept
            </button>
            <button type="button" disabled={busy} onClick={onReject}>
              Reject
            </button>
          </>
        ) : status === 'failed' ? (
          <p role="alert" className="cb-proposal-error">
            {error}
          </p>
        ) : (
          <span className="cb-proposal-outcome">
            {status === 'accepted' ? 'Accepted' : 'Rejected'}
          </span>
        )}
      </div>
    </div>
  )
}
