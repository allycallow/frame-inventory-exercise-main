'use client'

import { useQuery } from '@apollo/client/react'
import { Fragment, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { FrameHistoryDocument } from '../generated/graphql'
import { diffVersions, type FieldChange } from './frame-history-diff'
import { dateTime, errorMessage, label } from './inventory-api'
import { StatusChip } from './inventory-list'

const INITIAL_CHANGE_LIMIT = 5

function VersionChanges({ changes }: { changes: FieldChange[] }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const changesId = useId()
  if (!changes.length) return <p>No attribute changes</p>

  const remaining = changes.length - INITIAL_CHANGE_LIMIT
  return (
    <>
      <dl id={changesId} className="history-changes">
        {(expanded ? changes : changes.slice(0, INITIAL_CHANGE_LIMIT)).map(({ field, label, before, after }) => (
          <div key={field}>
            <dt>{label}</dt>
            <dd>
              <span className="visually-hidden">Changed from </span>
              {before ?? '—'}
              <span aria-hidden="true"> → </span>
              <span className="visually-hidden"> to </span>
              {after ?? '—'}
            </dd>
          </div>
        ))}
      </dl>
      {remaining > 0 && (
        <button
          type="button"
          className="text-button"
          aria-controls={changesId}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer' : `Show ${remaining} more`}
        </button>
      )}
    </>
  )
}

export function HistoryDialog({
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
            {data.frameHistory.map((version, index, versions) => {
              const previous = versions[index + 1]
              const { location, format, status } = version.attributes
              const locationSummary = [location?.town, location?.region, location?.postcode, location?.countryCode]
                .filter(Boolean).join(', ')
              const formatSummary = [format?.technology, format?.formatCode, format?.sizeGroupCode]
                .filter(Boolean).join(', ')
              const { importJobId } = version
              return (
                <Fragment key={version.versionId}>
                  {version.closedByChangeSource === 'MANUAL_DELETE' && (
                    <li>
                      <strong>Deleted</strong>
                      {version.validTo && <p className="subtle">{dateTime(version.validTo)}</p>}
                      <p>{label(version.closedByChangeSource)}</p>
                    </li>
                  )}
                  <li>
                    <div className="history-heading">
                      <strong>{previous ? `Version ${version.versionId}` : 'Created'}</strong>
                      <StatusChip value={status} />
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
                    {previous ? (
                      <VersionChanges changes={diffVersions(previous, version)} />
                    ) : (
                      <>
                        {locationSummary && <p>Location: {locationSummary}</p>}
                        {formatSummary && <p>Format: {formatSummary}</p>}
                      </>
                    )}
                    {importJobId && (
                      <button className="text-button job-link" onClick={() => onJob(importJobId)}>
                        Import job <span className="mono">{importJobId}</span>
                      </button>
                    )}
                  </li>
                </Fragment>
              )
            })}
          </ol>
        ) : (
          <p className="panel-message">No versions found.</p>
        ))}
    </dialog>
  )
}
