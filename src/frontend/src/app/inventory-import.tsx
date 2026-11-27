'use client'

import { useApolloClient } from '@apollo/client/react'
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import {
  CreateImportDocument,
  ImportStatusDocument,
  RowErrorsDocument,
  type CreateImportMutation,
  type ImportJobSummaryFragment,
  type RowErrorsQuery,
} from '../generated/graphql'
import { dateTime, errorMessage, label } from './inventory-api'
import { StatusChip } from './inventory-list'

type Upload = CreateImportMutation['createImportJob']
type RowErrors = RowErrorsQuery['importRowErrors']

const TERMINAL = new Set(['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'EXPIRED'])
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const TOKEN = /^[a-f0-9]{64}$/
const MAX_BYTES = 10 * 1024 * 1024

async function putCsv(upload: Upload, file: File): Promise<void> {
  const headers = new Headers(upload.uploadHeaders.map(({ name, value }) => [name, value]))
  const response = await fetch(upload.uploadUrl, { method: 'PUT', headers, body: file })
  if (response.status === 412) return // A prior attempt already stored this one-write object.
  if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}).`)
}

export function InventoryImport({
  trackedId,
  onTrack,
}: {
  trackedId: string
  onTrack: (id: string) => void
}): ReactElement {
  const client = useApolloClient()
  const [token, setToken] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [force, setForce] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [lookup, setLookup] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [retryUpload, setRetryUpload] = useState<{ upload: Upload; file: File } | null>(null)
  const [latest, setLatest] = useState<ImportJobSummaryFragment | null>(null)
  const [pollError, setPollError] = useState<{ id: string; message: string } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [errors, setErrors] = useState<{ id: string; data: RowErrors } | null>(null)
  const [errorsBusy, setErrorsBusy] = useState(false)
  const diagnosticsRequest = useRef<AbortController | null>(null)
  const [errorsMessage, setErrorsMessage] = useState<{ id: string; text: string } | null>(null)

  const authorized = TOKEN.test(token)
  const job = authorized && latest?.jobId === trackedId ? latest : null
  const rowErrors = authorized && errors?.id === trackedId ? errors.data : null
  const canRetry =
    retryUpload?.upload.job.jobId === trackedId && (!job || job.status === 'AWAITING_UPLOAD')

  useEffect(() => {
    if (!trackedId || !TOKEN.test(token)) return
    const request = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll(): Promise<void> {
      try {
        const { data } = await client.query({
          query: ImportStatusDocument,
          variables: { id: trackedId },
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
        setLatest(importJob)
        setPollError(null)
        if (!TERMINAL.has(importJob.status)) timer = setTimeout(poll, 2500)
      } catch (error) {
        if (!request.signal.aborted) setPollError({ id: trackedId, message: errorMessage(error) })
      }
    }
    void poll()
    return () => {
      request.abort()
      clearTimeout(timer)
    }
  }, [client, trackedId, token, refresh])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    setUploadError('')
    if (!TOKEN.test(token)) return setUploadError('Enter a valid local operator token.')
    if (
      !file ||
      !file.name.toLowerCase().endsWith('.csv') ||
      file.size === 0 ||
      file.size > MAX_BYTES
    ) {
      return setUploadError('Choose a non-empty CSV file up to 10 MiB.')
    }
    if (force && !confirmed) return setUploadError('Confirm the forced overwrite before uploading.')
    setBusy(true)
    setRetryUpload(null)
    let created: Upload | undefined
    try {
      const { data } = await client.mutate({
        mutation: CreateImportDocument,
        variables: { force },
        fetchPolicy: 'no-cache',
        context: { headers: { authorization: `Bearer ${token}` } },
      })
      if (!data) throw new Error('Inventory service returned no result.')
      created = data.createImportJob
      setLatest(created.job)
      setForce(false)
      setConfirmed(false)
      onTrack(created.job.jobId)
      await putCsv(created, file)
    } catch (error) {
      setUploadError(errorMessage(error))
      if (created) setRetryUpload({ upload: created, file })
    } finally {
      setBusy(false)
    }
  }

  async function retry(): Promise<void> {
    if (!retryUpload || busy) return
    const { upload, file: previousFile } = retryUpload
    if (Date.parse(upload.job.uploadExpiresAt) <= Date.now()) {
      setRetryUpload(null)
      return setUploadError('This upload link expired. Start a new upload.')
    }
    setBusy(true)
    setUploadError('')
    try {
      await putCsv(upload, previousFile)
      setRetryUpload(null)
      setRefresh((value) => value + 1)
    } catch (error) {
      setUploadError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function openJob(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const id = lookup.trim().toLowerCase()
    if (!UUID.test(id)) return setLookupError('Enter a valid import job ID.')
    setLookupError('')
    onTrack(id)
    setRefresh((value) => value + 1)
  }

  function updateToken(value: string): void {
    diagnosticsRequest.current?.abort()
    setToken(value)
    setLatest(null)
    setErrors(null)
    setErrorsMessage(null)
    setErrorsBusy(false)
    setPollError(null)
    setRetryUpload(null)
  }

  async function showErrors(page: number): Promise<void> {
    diagnosticsRequest.current?.abort()
    const request = new AbortController()
    diagnosticsRequest.current = request
    setErrorsBusy(true)
    setErrorsMessage(null)
    try {
      const { data } = await client.query({
        query: RowErrorsDocument,
        variables: { id: trackedId, page },
        fetchPolicy: 'no-cache',
        context: {
          headers: { authorization: `Bearer ${token}` },
          fetchOptions: { signal: request.signal },
          queryDeduplication: false,
        },
      })
      if (!data) throw new Error('Inventory service returned no result.')
      if (!request.signal.aborted) setErrors({ id: trackedId, data: data.importRowErrors })
    } catch (error) {
      if (!request.signal.aborted) {
        setErrorsMessage({ id: trackedId, text: errorMessage(error) })
      }
    } finally {
      if (!request.signal.aborted) setErrorsBusy(false)
    }
  }

  return (
    <div className="import-layout">
      <section className="card import-card" aria-labelledby="upload-title">
        <h2 id="upload-title">New import</h2>
        <p className="subtle">
          DELTA applies rows in the file. Frames absent from the file stay as they are.
        </p>
        <form className="fields" onSubmit={submit}>
          <label className="field">
            Local operator token
            <input
              type="password"
              autoComplete="off"
              disabled={busy}
              value={token}
              onChange={(event) => updateToken(event.target.value)}
            />
          </label>
          <label className="field file-field">
            Inventory CSV
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setRetryUpload(null)
              }}
            />
            <span className="subtle">Up to 10 MiB and 10,000 data rows.</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={force}
              onChange={(event) => {
                setForce(event.target.checked)
                setConfirmed(false)
              }}
            />{' '}
            Force overwrite
          </label>
          {force && (
            <label className="check force-check">
              <input
                type="checkbox"
                disabled={busy}
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I understand this can replace newer edits and restore manually deleted frames.
            </label>
          )}
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Uploading…' : 'Upload CSV'}
            </button>
            {canRetry && (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={retry}
              >
                Retry upload
              </button>
            )}
          </div>
          {uploadError && (
            <p className="error" role="alert">
              {uploadError}
            </p>
          )}
        </form>
      </section>

      <section className="card import-card" aria-labelledby="job-title">
        <div className="section-heading">
          <h2 id="job-title">Import job</h2>
          {job && <StatusChip value={job.status} />}
        </div>
        <form className="lookup" onSubmit={openJob}>
          <label className="field">
            Job ID
            <input
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              placeholder="Paste a job ID"
            />
          </label>
          <button className="button button-secondary" disabled={busy}>
            Open
          </button>
        </form>
        {lookupError && (
          <p className="error" role="alert">
            {lookupError}
          </p>
        )}
        {!trackedId && (
          <p className="subtle">Upload a file or open an existing job to view its progress.</p>
        )}
        {trackedId && <p className="mono job-id">{trackedId}</p>}
        {trackedId && !TOKEN.test(token) && (
          <p className="subtle">Enter your local operator token to view this job.</p>
        )}
        {trackedId && TOKEN.test(token) && !job && pollError?.id !== trackedId && (
          <p role="status">Loading job…</p>
        )}
        {pollError?.id === trackedId && (
          <div className="callout" role="alert">
            <p className="error">{pollError.message}</p>
            <button
              onClick={() => {
                setPollError(null)
                setRefresh((value) => value + 1)
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
            {errors?.id !== trackedId && (
              <button
                className="button button-secondary"
                disabled={errorsBusy || !TOKEN.test(token)}
                onClick={() => showErrors(0)}
              >
                {errorsBusy ? 'Loading row errors…' : 'View row errors'}
              </button>
            )}
          </div>
        )}
      </section>

      {((rowErrors && job) || errorsMessage?.id === trackedId) && (
        <section className="card diagnostics" aria-labelledby="errors-title">
          <div className="card-header">
            <h2 id="errors-title">Row errors</h2>
          </div>
          {errorsMessage?.id === trackedId && (
            <p className="panel-message error" role="alert">
              {errorsMessage.text}
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
                  disabled={!rowErrors.page || errorsBusy || !TOKEN.test(token)}
                  onClick={() => showErrors(rowErrors.page - 1)}
                >
                  Previous
                </button>
                <button
                  className="button button-secondary"
                  disabled={!rowErrors.hasNext || errorsBusy || !TOKEN.test(token)}
                  onClick={() => showErrors(rowErrors.page + 1)}
                >
                  Next
                </button>
                <button
                  className="button button-secondary"
                  disabled={errorsBusy || !TOKEN.test(token)}
                  onClick={() => showErrors(rowErrors.page)}
                >
                  Refresh
                </button>
              </div>
            </footer>
          )}
        </section>
      )}
    </div>
  )
}
