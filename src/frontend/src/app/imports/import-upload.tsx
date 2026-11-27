'use client'

import { useApolloClient } from '@apollo/client/react'
import { useParams, useRouter } from 'next/navigation'
import { useState, type ReactElement } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { CreateImportDocument, type CreateImportMutation } from '../../generated/graphql'
import { errorMessage } from '../inventory-api'
import { useImportToken } from '../inventory-workspace'
import { importJobHref, isOperatorToken } from './import-route'

type Upload = CreateImportMutation['createImportJob']
type UploadFields = {
  csv?: FileList
  force: boolean
  confirmed: boolean
}

const MAX_BYTES = 10 * 1024 * 1024

async function putCsv(upload: Upload, file: File): Promise<void> {
  const headers = new Headers(upload.uploadHeaders.map<[string, string]>(({ name, value }) => [name, value]))
  const response = await fetch(upload.uploadUrl, { method: 'PUT', headers, body: file })
  if (response.status === 412) return // A prior attempt already stored this one-write object.
  if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}).`)
}

export function ImportUpload(): ReactElement {
  const client = useApolloClient()
  const router = useRouter()
  const { jobId } = useParams<{ jobId?: string }>()
  const { token, setToken } = useImportToken()
  const {
    control,
    register,
    handleSubmit,
    resetField,
    setError,
    clearErrors,
    formState: { errors: uploadErrors, isSubmitting },
  } = useForm<UploadFields>({ defaultValues: { force: false, confirmed: false } })
  const force = useWatch({ control, name: 'force' })
  const [retrying, setRetrying] = useState(false)
  const [retryUpload, setRetryUpload] = useState<{ upload: Upload; file: File } | null>(null)

  const busy = isSubmitting || retrying
  const uploadError = uploadErrors.root?.upload?.message
  const canRetry = retryUpload !== null && retryUpload.upload.job.jobId === jobId

  async function submit({ csv, force, confirmed }: UploadFields): Promise<void> {
    if (busy) return
    const file = csv?.[0]
    if (!isOperatorToken(token)) {
      return setError('root.upload', { message: 'Enter a valid local operator token.' })
    }
    if (
      !file ||
      !file.name.toLowerCase().endsWith('.csv') ||
      file.size === 0 ||
      file.size > MAX_BYTES
    ) {
      return setError('root.upload', { message: 'Choose a non-empty CSV file up to 10 MiB.' })
    }
    if (force && !confirmed) {
      return setError('root.upload', { message: 'Confirm the forced overwrite before uploading.' })
    }
    setRetryUpload(null)
    const startingPath = window.location.pathname
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
      resetField('confirmed')
      resetField('force')
      if (window.location.pathname === startingPath && created.job.jobId !== jobId) {
        router.push(importJobHref(created.job.jobId))
      }
      await putCsv(created, file)
    } catch (error) {
      setError('root.upload', { message: errorMessage(error) })
      if (created) setRetryUpload({ upload: created, file })
    }
  }

  async function retry(): Promise<void> {
    if (!retryUpload || busy) return
    const { upload, file: previousFile } = retryUpload
    if (Date.parse(upload.job.uploadExpiresAt) <= Date.now()) {
      setRetryUpload(null)
      return setError('root.upload', { message: 'This upload link expired. Start a new upload.' })
    }
    setRetrying(true)
    clearErrors('root.upload')
    try {
      await putCsv(upload, previousFile)
      setRetryUpload(null)
    } catch (error) {
      setError('root.upload', { message: errorMessage(error) })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <section className="card import-card" aria-labelledby="upload-title">
      <h2 id="upload-title">New import</h2>
      <p className="subtle">
        DELTA applies rows in the file. Frames absent from the file stay as they are.
      </p>
      <form className="fields" onSubmit={handleSubmit(submit)}>
        <label className="field">
          Local operator token
          <input
            type="password"
            autoComplete="off"
            disabled={busy}
            value={token}
            onChange={(event) => {
              setRetryUpload(null)
              setToken(event.target.value)
            }}
          />
        </label>
        <label className="field file-field">
          Inventory CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            {...register('csv', { onChange: () => setRetryUpload(null) })}
          />
          <span className="subtle">Up to 10 MiB and 10,000 data rows.</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            disabled={busy}
            {...register('force', { onChange: () => resetField('confirmed') })}
          />{' '}
          Force overwrite
        </label>
        {force && (
          <label className="check force-check">
            <input
              type="checkbox"
              disabled={busy}
              {...register('confirmed')}
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
  )
}
