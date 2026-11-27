'use client'

import { CombinedGraphQLErrors } from '@apollo/client/errors'
import { useQuery } from '@apollo/client/react'
import Link from 'next/link'
import { useState, type ReactElement, type ReactNode } from 'react'
import { FrameDetailDocument } from '../generated/graphql'
import { FrameDialog } from './frame-dialog'
import { HistoryDialog } from './frame-history'
import { frameDetailHref } from './frame-route'
import { errorMessage } from './inventory-api'
import { StatusChip } from './inventory-list'
import { useInventoryActions } from './inventory-workspace'

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
  const [showEdit, setShowEdit] = useState(false)
  const [savedFrameId, setSavedFrameId] = useState<string | null>(null)
  const { showImports } = useInventoryActions()
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

  return (
    <>
      <Link className="text-button detail-back" href="/">← Back to frames</Link>
      <div className="page-heading detail-heading">
        <h1>{frameId}</h1>
        {frame && (
          <div className="actions">
            <button className="button button-secondary" onClick={() => setShowHistory(true)}>
              Version history
            </button>
            {frame.current && (
              <button className="button button-primary" onClick={() => {
                setSavedFrameId(null)
                setShowEdit(true)
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
      {loading ? (
        <p className="card panel-message" role="status">Loading frame details…</p>
      ) : notFound ? (
        <p className="card panel-message" role="status">Frame not found.</p>
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
          <DetailFields title="Frame" fields={[
            ['Status', <StatusChip key="status" value={attributes.status} />],
            ['Status reason', attributes.statusReason],
            ['Site number', attributes.siteNo],
            ['Inventory site number', attributes.inventorySiteNo],
            ['Panel number', attributes.panelNumber],
            ['Location ID', attributes.locationId],
            ['Environment', attributes.environment],
          ]} />
          <DetailFields title="Location" fields={[
            ['Address', attributes.address],
            ['Country code', attributes.location?.countryCode],
            ['Region', attributes.location?.region],
            ['Town', attributes.location?.town],
            ['Postcode', attributes.location?.postcode],
            ['Station', attributes.station],
            ['Airport', attributes.airport],
            ['Latitude', attributes.latitude],
            ['Longitude', attributes.longitude],
            ['Distance to closest school', attributes.distanceToClosestSchool == null
              ? null : `${attributes.distanceToClosestSchool} m`],
          ]} />
          <DetailFields title="Format and specifications" fields={[
            ['Technology', attributes.format?.technology],
            ['Format code', attributes.format?.formatCode],
            ['Size group code', attributes.format?.sizeGroupCode],
            ['Size code', attributes.sizeCode],
            ['Aspect ratio code', attributes.aspectRatioCode],
            ['T-size', attributes.tSize],
            ['Pixel height', attributes.pixelHeight],
            ['Pixel width', attributes.pixelWidth],
            ['Illumination type ID', attributes.illuminationTypeId],
            ['Number of slots', attributes.numberOfSlots],
          ]} />
          <DetailFields title="Commercial" fields={[
            ['Impact weight', attributes.impactWeight],
            ['Premium', attributes.premium ? 'Yes' : 'No'],
            ['Production rate card', attributes.productionRateCard],
            ['Legacy production rate card', attributes.productionRateCardLegacy],
            ['Pricing grade', attributes.pricingGrade],
          ]} />
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
          onJob={showImports}
        />
      )}
      {showEdit && (
        <FrameDialog
          frameId={frameId}
          onClose={() => setShowEdit(false)}
          onSaved={(id) => {
            setShowEdit(false)
            setSavedFrameId(id)
            void refetch().catch(() => undefined)
          }}
        />
      )}
    </>
  )
}
