'use client'

import { useQuery } from '@apollo/client/react'
import Link from 'next/link'
import { useState, type ChangeEvent, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { FramesDocument, type FramesQueryVariables } from '../generated/graphql'
import { FRAME_STATUSES } from './frame-form-input'
import { frameDetailHref } from './frame-route'
import { errorMessage, label } from './inventory-api'

export function StatusChip({ value }: { value: string }): ReactElement {
  return (
    <span className="chip" data-status={value}>
      <span aria-hidden="true" />
      {label(value)}
    </span>
  )
}

export function InventoryList({ active, onEdit }: {
  active: boolean
  onEdit: (frameId: string) => void
}): ReactElement {
  const [variables, setVariables] = useState<FramesQueryVariables>({ page: 0 })
  const { register, handleSubmit, reset } = useForm({
    defaultValues: { search: '', status: '' },
  })

  function submitSearch({ search }: { search: string }): void {
    setVariables((current) => ({ ...current, page: 0, search: search.trim() || undefined }))
  }

  return (
    <section className="inventory-results" aria-label="Inventory frames">
      <form
        className="card frame-filters"
        role="search"
        aria-label="Filter frames"
        onSubmit={handleSubmit(submitSearch)}
        onReset={(event) => {
          event.preventDefault()
          reset()
          setVariables({ page: 0 })
        }}
      >
        <h2>Filters</h2>
        <label className="field">
          Frame ID or town
          <input type="search" {...register('search')} />
        </label>
        <label className="field">
          Status
          <select
            {...register('status', {
              onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                const status = event.target.value
                setVariables((current) => ({
                  ...current,
                  page: 0,
                  statuses: status ? [status] : undefined,
                }))
              },
            })}
          >
            <option value="">All statuses</option>
            {FRAME_STATUSES.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button className="button button-primary" type="submit">Search</button>
          <button className="button button-secondary" type="reset">Clear filters</button>
        </div>
      </form>
      <div className="card">
        <FrameResults
          active={active}
          onEdit={onEdit}
          variables={variables}
          onPage={(page) => setVariables((current) => ({ ...current, page }))}
        />
      </div>
    </section>
  )
}

function FrameResults({
  active,
  variables,
  onPage,
  onEdit,
}: {
  active: boolean
  variables: FramesQueryVariables
  onPage: (page: number) => void
  onEdit: (frameId: string) => void
}): ReactElement {
  const { page, search, statuses } = variables
  const { data, loading, error, refetch } = useQuery(FramesDocument, {
    variables,
    skip: !active,
    fetchPolicy: 'network-only',
    ssr: false,
  })

  if (!active) return <></>

  if (loading)
    return (
      <p className="panel-message" role="status">
        Loading frames…
      </p>
    )
  if (error || !data) {
    return (
      <div className="panel-message" role="alert">
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
  const emptyMessage = page > 0
    ? 'No frames on this page.'
    : search || statuses?.length
      ? 'No frames match your filters.'
      : 'No frames in inventory yet.'
  return (
    <>
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
                    <Link className="text-button mono" href={frameDetailHref(frameId)}>
                      {frameId}
                    </Link>
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
        <p className="panel-message" role="status">{emptyMessage}</p>
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
              onClick={() => onPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="button button-secondary"
              disabled={!hasNext}
              onClick={() => onPage(page + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      )}
    </>
  )
}
