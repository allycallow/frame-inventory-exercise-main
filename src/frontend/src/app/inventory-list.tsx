'use client'

import { useEffect, useRef, useState, type ReactElement } from 'react'
import { dateTime, errorMessage, graphql, label } from './inventory-api'

interface FrameRow {
  frameId: string
  attributes: {
    status: string
    environment: string | null
    siteNo: string | null
    address: string | null
    location: { town: string; postcode: string } | null
    format: { technology: string; formatCode: string } | null
  }
}

interface FrameHistory {
  versionId: string
  validFrom: string
  validTo: string | null
  current: boolean
  changeSource: string | null
  closedByChangeSource: string | null
  importJobId: string | null
  attributes: { status: string; statusReason: string | null }
}

interface FramePage {
  items: FrameRow[]
  page: number
  size: number
  hasNext: boolean
}

type Result<T> = { data: T } | { error: string } | null

const LIST = `query Frames($page: Int!) {
  frames(page: $page, size: 25) {
    page size hasNext
    items { frameId attributes {
      status environment siteNo address location { town postcode } format { technology formatCode }
    } }
  }
}`
const HISTORY = `query FrameHistory($id: ID!) {
  frameHistory(frameId: $id) {
    versionId validFrom validTo current changeSource closedByChangeSource importJobId
    attributes { status statusReason }
  }
}`

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
  const [history, setHistory] = useState<Result<FrameHistory[]>>(null)
  useEffect(() => {
    const modal = dialog.current
    modal?.showModal()
    const request = new AbortController()
    graphql<{ frameHistory: FrameHistory[] }>(HISTORY, { id: frameId }, { signal: request.signal })
      .then(({ frameHistory }) => setHistory({ data: frameHistory }))
      .catch((error: unknown) => {
        if (!request.signal.aborted) setHistory({ error: errorMessage(error) })
      })
    return () => {
      request.abort()
      modal?.close()
    }
  }, [frameId])

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
      {!history && (
        <p className="panel-message" role="status">
          Loading version history…
        </p>
      )}
      {history && 'error' in history && (
        <p className="panel-message error" role="alert">
          {history.error}
        </p>
      )}
      {history &&
        'data' in history &&
        (history.data.length ? (
          <ol className="timeline">
            {history.data.map((version) => (
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

export function InventoryList({ onJob }: { onJob: (jobId: string) => void }): ReactElement {
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState<Result<FramePage>>(null)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const request = new AbortController()
    graphql<{ frames: FramePage }>(LIST, { page }, { signal: request.signal })
      .then(({ frames }) => setResult({ data: frames }))
      .catch((error: unknown) => {
        if (!request.signal.aborted) setResult({ error: errorMessage(error) })
      })
    return () => request.abort()
  }, [page, reload])

  function navigate(next: number): void {
    setResult(null)
    setPage(next)
  }

  if (!result)
    return (
      <p className="card panel-message" role="status">
        Loading frames…
      </p>
    )
  if ('error' in result) {
    return (
      <div className="card panel-message" role="alert">
        <p className="error">{result.error}</p>
        <button
          className="button button-secondary"
          onClick={() => {
            setResult(null)
            setReload(reload + 1)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

  const { items, hasNext, size } = result.data
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
              onClick={() => navigate(page - 1)}
            >
              Previous
            </button>
            <button
              className="button button-secondary"
              disabled={!hasNext}
              onClick={() => navigate(page + 1)}
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
