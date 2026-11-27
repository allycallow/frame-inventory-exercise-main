'use client'

import { useQuery } from '@apollo/client/react'
import Link from 'next/link'
import { useEffect, useRef, type ReactElement } from 'react'
import { FrameHistoryDocument } from '../generated/graphql'
import { dateTime, errorMessage, label } from './inventory-api'
import { StatusChip } from './inventory-list'
import { importJobHref } from './imports/import-route'

export function HistoryDialog({
  frameId,
  onClose,
}: {
  frameId: string
  onClose: () => void
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const { data, loading, error } = useQuery(FrameHistoryDocument, {
    variables: { id: frameId },
    fetchPolicy: 'network-only',
    ssr: false,
  })
  useEffect(() => {
    const modal = dialog.current
    modal?.showModal()
    return () => modal?.close()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="history-dialog"
      aria-labelledby="history-title"
      onCancel={onClose}
    >
      <header className="drawer-header">
        <div>
          <p className="subtle mono">{frameId}</p>
          <h2 id="history-title">Version history</h2>
        </div>
        <button className="button button-secondary" onClick={onClose} autoFocus>
          Close
        </button>
      </header>
      {loading && (
        <p className="panel-message" role="status">
          Loading version history…
        </p>
      )}
      {error && (
        <p className="panel-message error" role="alert">
          {errorMessage(error)}
        </p>
      )}
      {data &&
        (data.frameHistory.length ? (
          <ol className="timeline">
            {data.frameHistory.map((version) => (
              <li key={version.versionId}>
                <div className="history-heading">
                  <strong>Version {version.versionId}</strong>
                  <StatusChip value={version.attributes.status} />
                </div>
                <p className="subtle">
                  {dateTime(version.validFrom)} ·{' '}
                  {version.current
                    ? 'Current'
                    : version.validTo
                      ? `Ended ${dateTime(version.validTo)}`
                      : 'Historical'}
                </p>
                {version.changeSource && <p>{label(version.changeSource)}</p>}
                {version.closedByChangeSource && (
                  <p>Closed by {label(version.closedByChangeSource).toLowerCase()}</p>
                )}
                {version.attributes.statusReason && <p>{version.attributes.statusReason}</p>}
                {version.importJobId && (
                  <Link
                    className="text-button job-link"
                    href={importJobHref(version.importJobId)}
                    onNavigate={onClose}
                  >
                    Import job <span className="mono">{version.importJobId}</span>
                  </Link>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="panel-message">No versions found.</p>
        ))}
    </dialog>
  )
}
