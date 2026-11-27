'use client'

import { useApolloClient } from '@apollo/client/react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import {
  ImportStatusDocument,
  RowErrorsDocument,
  type ImportJobSummaryFragment,
  type RowErrorsQuery,
} from '../../generated/graphql'
import { dateTime, errorMessage, label } from '../inventory-api'
import { StatusChip } from '../inventory-list'
import { useImportToken } from '../inventory-workspace'
import { importJobHref, isImportJobId, isOperatorToken } from './import-route'

const TERMINAL = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'EXPIRED'])

export function ImportJob({ jobId }: { jobId?: string }): ReactElement {
  const router = useRouter()
  const { token } = useImportToken()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: { id: '' }, reValidateMode: 'onSubmit' })
  const [refresh, setRefresh] = useState(0)
  const lookupError = errors.id?.message
  const authorized = isOperatorToken(token)

  function openJob({ id }: { id: string }): void {
    if (id === jobId) {
      setRefresh((value) => value + 1)
    } else {
      router.push(importJobHref(id))
    }
  }

  const lookup = (
    <>
      <form className="lookup" onSubmit={handleSubmit(openJob)}>
        <label className="field">
          Job ID
          <input
            {...register('id', {
              setValueAs: (value: string) => value.trim().toLowerCase(),
              validate: (id) => isImportJobId(id) || 'Enter a valid import job ID.',
            })}
            aria-invalid={Boolean(lookupError)}
            aria-describedby={lookupError ? 'lookup-error' : undefined}
            placeholder="Paste a job ID"
          />
        </label>
        <button className="button button-secondary">
          Open
        </button>
      </form>
      {lookupError && (
        <p id="lookup-error" className="error" role="alert">
          {lookupError}
        </p>
      )}
      {!jobId && (
        <p className="subtle">Upload a file or open an existing job to view its progress.</p>
      )}
      {jobId && <p className="mono job-id">{jobId}</p>}
      {jobId && !authorized && (
        <p className="subtle">Enter your local operator token to view this job.</p>
      )}
    </>
  )

  if (jobId && authorized) {
    return (
      <ImportJobResults key={token} jobId={jobId} token={token} refresh={refresh}>
        {lookup}
      </ImportJobResults>
    )
  }

  return (
    <section className="card import-card" aria-labelledby="job-title">
      <h2 id="job-title">Import job</h2>
      {lookup}
    </section>
  )
}

function ImportJobResults({ jobId, token, refresh, children }: {
  jobId: string
  token: string
  refresh: number
  children: ReactNode
}): ReactElement {
  const client = useApolloClient()
  const [job, setJob] = useState<ImportJobSummaryFragment | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [rowErrors, setRowErrors] = useState<RowErrorsQuery['importRowErrors'] | null>(null)
  const [errorsBusy, setErrorsBusy] = useState(false)
  const diagnosticsRequest = useRef<AbortController | null>(null)
  const [errorsMessage, setErrorsMessage] = useState<string | null>(null)

  useEffect(() => {
    const request = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll(): Promise<void> {
      try {
        const { data } = await client.query({
          query: ImportStatusDocument,
          variables: { id: jobId },
          fetchPolicy: 'no-cache',
          context: {
            headers: { authorization: `Bearer ${token}` },
            fetchOptions: { signal: request.signal },
            queryDeduplication: false,
          },
        })
        if (request.signal.aborted) return
        if (!data) throw new Error('Inventory service returned no result.')
        const { importJob } = data
        setJob(importJob)
        setPollError(null)
        if (!TERMINAL.has(importJob.status)) timer = setTimeout(poll, 2500)
      } catch (error) {
        if (!request.signal.aborted) setPollError(errorMessage(error))
      }
    }
    void poll()
    return () => {
      request.abort()
      clearTimeout(timer)
    }
  }, [client, jobId, token, refresh, retry])

  useEffect(() => () => diagnosticsRequest.current?.abort(), [])

  async function showErrors(page: number): Promise<void> {
    diagnosticsRequest.current?.abort()
    const request = new AbortController()
    diagnosticsRequest.current = request
    setErrorsBusy(true)
    setErrorsMessage(null)
    try {
      const { data } = await client.query({
        query: RowErrorsDocument,
        variables: { id: jobId, page },
        fetchPolicy: 'no-cache',
        context: {
          headers: { authorization: `Bearer ${token}` },
          fetchOptions: { signal: request.signal },
          queryDeduplication: false,
        },
      })
      if (!data) throw new Error('Inventory service returned no result.')
      if (!request.signal.aborted) setRowErrors(data.importRowErrors)
    } catch (error) {
      if (!request.signal.aborted) {
        setErrorsMessage(errorMessage(error))
      }
    } finally {
      if (!request.signal.aborted) setErrorsBusy(false)
    }
  }

  return (
    <>
      <section className="card import-card" aria-labelledby="job-title">
        <div className="section-heading">
          <h2 id="job-title">Import job</h2>
          {job && <StatusChip value={job.status} />}
        </div>
        {children}
        {!job && !pollError && (
          <p role="status">Loading job…</p>
        )}
        {pollError && (
          <div className="callout" role="alert">
            <p className="error">{pollError}</p>
            <button
              onClick={() => {
                setPollError(null)
                setRetry((value) => value + 1)
              }}
              className="button button-secondary"
            >
              Refresh status
            </button>
          </div>
        )}
        {job && (
          <div className="job-summary" aria-live="polite">
            {job.status === 'AWAITING_UPLOAD' && (
              <p className="subtle">Upload link expires {dateTime(job.uploadExpiresAt)}.</p>
            )}
            {job.finishedAt && <p className="subtle">Finished {dateTime(job.finishedAt)}.</p>}
            {job.forceOverwrite && <p className="subtle">Force overwrite requested.</p>}
            {job.failureCode && <p className="error">{label(job.failureCode)}</p>}
            <dl className="counts">
              <div>
                <dt>Read</dt>
                <dd>{job.rowsRead}</dd>
              </div>
              <div>
                <dt>Applied</dt>
                <dd>{job.rowsApplied}</dd>
              </div>
              <div>
                <dt>Unchanged</dt>
                <dd>{job.rowsUnchanged}</dd>
              </div>
              <div>
                <dt>Rejected</dt>
                <dd>{job.rowsRejected}</dd>
              </div>
            </dl>
            {!rowErrors && (
              <button
                className="button button-secondary"
                disabled={errorsBusy}
                onClick={() => showErrors(0)}
              >
                {errorsBusy ? 'Loading row errors…' : 'View row errors'}
              </button>
            )}
          </div>
        )}
      </section>

      {(rowErrors || errorsMessage) && (
        <section className="card diagnostics" aria-labelledby="errors-title">
          <div className="card-header">
            <h2 id="errors-title">Row errors</h2>
          </div>
          {errorsMessage && (
            <p className="panel-message error" role="alert">
              {errorsMessage}
            </p>
          )}
          {rowErrors?.items.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Frame ID</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {rowErrors.items.map((row) => (
                    <tr key={`${row.rowNumber}-${row.code}`}>
                      <td>{row.rowNumber}</td>
                      <td>{row.frameId ?? '—'}</td>
                      <td>{label(row.code)}</td>
                      <td>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            rowErrors && (
              <p className="panel-message">
                No row errors are available. Diagnostics are kept for seven days after the job
                finishes.
              </p>
            )
          )}
          {rowErrors && (
            <footer className="pagination">
              <span>Page {rowErrors.page + 1}</span>
              <div>
                <button
                  className="button button-secondary"
                  disabled={!rowErrors.page || errorsBusy}
                  onClick={() => showErrors(rowErrors.page - 1)}
                >
                  Previous
                </button>
                <button
                  className="button button-secondary"
                  disabled={!rowErrors.hasNext || errorsBusy}
                  onClick={() => showErrors(rowErrors.page + 1)}
                >
                  Next
                </button>
                <button
                  className="button button-secondary"
                  disabled={errorsBusy}
                  onClick={() => showErrors(rowErrors.page)}
                >
                  Refresh
                </button>
              </div>
            </footer>
          )}
        </section>
      )}
    </>
  )
}
