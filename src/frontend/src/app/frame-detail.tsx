'use client'

import { CombinedGraphQLErrors } from '@apollo/client/errors'
import { skipToken, useQuery } from '@apollo/client/react'
import Link from 'next/link'
import { useState, type ReactElement, type ReactNode } from 'react'
import { FrameDetailDocument, FrameHistoryDocument } from '../generated/graphql'
import { formatFrameField, frameFieldGroups } from './frame-fields'
import { HistoryDialog } from './frame-history'
import { frameDetailHref } from './frame-route'
import { errorMessage } from './inventory-api'
import { StatusChip } from './inventory-list'
import { useFrameDialog } from './inventory-workspace'

function DetailFields({ title, fields }: {
  title: string
  fields: ReadonlyArray<readonly [string, ReactNode]>
}): ReactElement {
  return (
    <section className="card detail-card">
      <h2>{title}</h2>
      <dl className="detail-fields">
        {fields.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value == null || value === '' ? <span className="subtle">—</span> : value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function FrameDetail({ frameId }: { frameId: string }): ReactElement {
  const [showHistory, setShowHistory] = useState(false)
  const [savedFrameId, setSavedFrameId] = useState<string | null>(null)
  const openFrameDialog = useFrameDialog()
  const { data, loading, error, refetch } = useQuery(FrameDetailDocument, {
    variables: { id: frameId },
    fetchPolicy: 'network-only',
    ssr: false,
  })
  const frame = data?.frame
  const attributes = frame?.attributes
  const notFound = (frame === null && !error) || (
    CombinedGraphQLErrors.is(error) &&
    error.errors.every(({ extensions }) => extensions?.code === 'NOT_FOUND')
  )

  const { data: history, loading: historyLoading } = useQuery(FrameHistoryDocument, notFound ? {
    variables: { id: frameId },
    fetchPolicy: 'network-only',
    ssr: false,
  } : skipToken)
  const deleted = notFound && history?.frameHistory[0]?.closedByChangeSource === 'MANUAL_DELETE'

  return (
    <>
      <Link className="text-button detail-back" href="/frames">← Back to frames</Link>
      <div className="page-heading detail-heading">
        <h1>{frameId}</h1>
        {(frame || deleted) && (
          <div className="actions">
            <button className="button button-secondary" onClick={() => setShowHistory(true)}>
              Version history
            </button>
            {frame?.current && (
              <button className="button button-primary" onClick={() => {
                setSavedFrameId(null)
                openFrameDialog(frameId, (id) => {
                  setSavedFrameId(id)
                  void refetch().catch(() => undefined)
                })
              }}>
                Edit
              </button>
            )}
          </div>
        )}
      </div>
      {savedFrameId === frameId && (
        <p className="card panel-message frame-saved" role="status">
          Frame <strong>{savedFrameId}</strong> was updated.
        </p>
      )}
      {loading || (notFound && historyLoading) ? (
        <p className="card panel-message" role="status">Loading frame details…</p>
      ) : notFound ? (
        <p className="card panel-message" role="status">{deleted ? 'This frame was deleted.' : 'Frame not found.'}</p>
      ) : error || !frame || !attributes ? (
        <div className="card panel-message" role="alert">
          <p className="error">{error ? errorMessage(error) : 'Inventory service returned no result.'}</p>
          <button className="button button-secondary" onClick={() => {
            void refetch().catch(() => undefined)
          }}>
            Try again
          </button>
        </div>
      ) : (
        <div className="detail-grid">
          {frameFieldGroups.map(({ title, fields }) => (
            <DetailFields key={title} title={title} fields={fields.map(([field, name, read]) => [
              name,
              field === 'status'
                ? <StatusChip key="status" value={attributes.status} />
                : formatFrameField(field, read(attributes)),
            ])} />
          ))}
          {frame.externalReferences.length > 0 ? (
            <DetailFields title="External references" fields={
              frame.externalReferences.map(({ key, value }) => [key, value])
            } />
          ) : (
            <section className="card detail-card">
              <h2>External references</h2>
              <p className="subtle">No external references.</p>
            </section>
          )}
          <section className="card detail-card">
            <h2>Linked frames</h2>
            {frame.linkedFrameIds.length > 0 ? (
              <ul className="detail-links">
                {frame.linkedFrameIds.map((id, position) => (
                  <li key={`${position}:${id}`} className="mono">
                    {id === frameId ? id : (
                      <Link className="text-button" href={frameDetailHref(id)}>
                        {id}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="subtle">No linked frames.</p>}
          </section>
        </div>
      )}
      {showHistory && (
        <HistoryDialog
          frameId={frameId}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  )
}
