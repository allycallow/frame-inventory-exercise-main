'use client'

import { useQuery } from '@apollo/client/react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { FrameHistoryDocument, FramesDocument } from '../generated/graphql'
import { dateTime, errorMessage, label } from './inventory-api'

export function StatusChip({ value }: { value: string }): ReactElement {
  return (
    <span className="chip" data-status={value}>
      <span aria-hidden="true" />
      {label(value)}
    </span>
  )
}

function HistoryDialog({
  frameId,
  onClose,
  onJob,
}: {
  frameId: string
  onClose: () => void
  onJob: (jobId: string) => void
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
                  <button
                    className="text-button job-link"
                    onClick={() => {
                      if (version.importJobId) onJob(version.importJobId)
                    }}
                  >
                    Import job <span className="mono">{version.importJobId}</span>
                  </button>
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

export function InventoryList({
  onEdit,
  onJob,
}: {
  onEdit: (frameId: string) => void
  onJob: (jobId: string) => void
}): ReactElement {
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const { data, loading, error, refetch } = useQuery(FramesDocument, {
    variables: { page },
    fetchPolicy: 'network-only',
    ssr: false,
  })

  if (loading)
    return (
      <p className="card panel-message" role="status">
        Loading frames…
      </p>
    )
  if (error || !data) {
    return (
      <div className="card panel-message" role="alert">
        <p className="error">
          {error ? errorMessage(error) : 'Inventory service returned no result.'}
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            void refetch().catch(() => undefined)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  const { items, hasNext, size } = data.frames
  return (
    <section className="card" aria-label="Inventory frames">
      {items.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Frame ID</th>
                <th scope="col">Location</th>
                <th scope="col">Environment</th>
                <th scope="col">Format</th>
                <th scope="col">Site</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ frameId, attributes: frame }) => (
                <tr key={frameId}>
                  <th scope="row">
                    <button
                      className="text-button mono"
                      onClick={() => setSelected(frameId)}
                      aria-label={`View history for ${frameId}`}
                    >
                      {frameId}
                    </button>
                  </th>
                  <td>
                    {frame.location
                      ? `${frame.location.town} · ${frame.location.postcode}`
                      : frame.address || '—'}
                  </td>
                  <td>{frame.environment ? label(frame.environment) : '—'}</td>
                  <td>{frame.format ? label(frame.format.formatCode) : '—'}</td>
                  <td>{frame.siteNo || '—'}</td>
                  <td>
                    <StatusChip value={frame.status} />
                  </td>
                  <td>
                    <button className="text-button" onClick={() => onEdit(frameId)} aria-label={`Edit frame ${frameId}`}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-message">
          {page === 0 ? 'No frames in inventory yet.' : 'No frames on this page.'}
        </p>
      )}
      {(items.length > 0 || page > 0) && (
        <footer className="pagination">
          <span>
            {items.length
              ? `Showing ${page * size + 1}–${page * size + items.length}`
              : `Page ${page + 1}`}
          </span>
          <div>
            <button
              className="button button-secondary"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="button button-secondary"
              disabled={!hasNext}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      )}
      {selected && (
        <HistoryDialog
          frameId={selected}
          onClose={() => setSelected(null)}
          onJob={(id) => {
            setSelected(null)
            onJob(id)
          }}
        />
      )}
    </section>
  )
}
