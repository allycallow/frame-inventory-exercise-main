'use client'

import { CombinedGraphQLErrors } from '@apollo/client/errors'
import { skipToken, useMutation, useQuery } from '@apollo/client/react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import {
  CreateFrameDocument,
  FrameForEditDocument,
  FramesDocument,
  UpdateFrameDocument,
} from '../generated/graphql'
import {
  FRAME_STATUSES,
  FRAME_TECHNOLOGIES,
  MAX_SLOTS,
  frameFormValues,
  readCreateFrameInput,
  readUpdateFrameInput,
  type FrameFormValues,
} from './frame-form-input'
import { errorMessage, label } from './inventory-api'

export function FrameDialog({
  frameId,
  refetchFrameList,
  onClose,
  onSaved,
}: {
  frameId?: string
  refetchFrameList: boolean
  onClose: () => void
  onSaved: (frameId: string) => void
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const [conflict, setConflict] = useState(false)
  const details = useQuery(
    FrameForEditDocument,
    frameId === undefined
      ? skipToken
      : {
          variables: { frameId },
          fetchPolicy: 'no-cache',
          ssr: false,
        },
  )
  const refetchQueries = refetchFrameList ? [FramesDocument] : []
  const [createFrame] = useMutation(CreateFrameDocument, { refetchQueries })
  const [updateFrame] = useMutation(UpdateFrameDocument, { refetchQueries })

  const editing = frameId !== undefined
  const current = (details.data ?? details.previousData)?.frame
  const frame = current?.current ? current : undefined
  const values = useMemo(() => frameFormValues(frame), [frame])
  const {
    register,
    handleSubmit,
    reset,
    setError,
    setFocus,
    formState: { errors, isSubmitting: saving },
  } = useForm({ values })
  const submitError = errors.root?.submit?.message
  const fieldsDisabled = saving || details.loading
  const loadError = details.error
    ? errorMessage(details.error)
    : editing && !details.loading && !frame
      ? 'This frame no longer has a current version.'
      : ''

  useEffect(() => {
    const modal = dialog.current
    modal?.showModal()
    if (!editing) setFocus('frameId')
    return () => modal?.close()
  }, [editing, setFocus])

  function cancel(): void {
    if (saving) return
    dialog.current?.close()
    onClose()
  }

  async function reload(): Promise<void> {
    try {
      const { data } = await details.refetch()
      if (data?.frame?.current) {
        setConflict(false)
        reset(frameFormValues(data.frame))
      }
    } catch {
      // The query error is shown in the dialog.
    }
  }

  async function submit(form: FrameFormValues): Promise<void> {
    if (fieldsDisabled || conflict || loadError || (editing && !frame)) return
    const input = frame
      ? { mode: 'edit' as const, result: readUpdateFrameInput(form, frame) }
      : { mode: 'create' as const, result: readCreateFrameInput(form) }
    if ('error' in input.result) {
      setError('root.submit', { message: input.result.error })
      return
    }
    try {
      const saved =
        input.mode === 'edit'
          ? (await updateFrame({ variables: input.result.variables })).data?.updateFrame
          : (await createFrame({ variables: input.result.variables })).data?.createFrame
      if (!saved) throw new Error('Inventory service returned no result.')
      dialog.current?.close()
      onSaved(saved.frameId)
    } catch (error) {
      if (
        editing &&
        CombinedGraphQLErrors.is(error) &&
        error.errors.some(({ extensions }) => extensions?.code === 'CONFLICT')
      ) {
        setConflict(true)
      } else {
        setError('root.submit', { message: errorMessage(error) })
      }
    }
  }

  return (
    <dialog
      ref={dialog}
      className="frame-dialog"
      aria-labelledby="frame-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
    >
      <header className="drawer-header">
        <h2 id="frame-dialog-title">{editing ? 'Edit frame' : 'Add a frame'}</h2>
        <button
          type="button"
          className="button button-secondary"
          onClick={cancel}
          disabled={saving}
        >
          Cancel
        </button>
      </header>
      {details.loading && !frame && (
        <p className="panel-message" role="status">
          Loading frame…
        </p>
      )}
      {loadError && (
        <div className="panel-message" role="alert">
          <p className="error">{loadError}</p>
          {(!conflict || !frame) && (
            <button
              type="button"
              className="button button-secondary"
              onClick={reload}
              disabled={details.loading}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {(!editing || frame) && (
        <form
          className="frame-form fields"
          onSubmit={(event) => void handleSubmit(submit)(event)}
          aria-busy={fieldsDisabled}
        >
          <fieldset className="fields" disabled={fieldsDisabled}>
            <legend>Basics</legend>
            <label className="field">
              {editing ? 'Frame ID' : 'Frame ID (required)'}
              <input
                {...register('frameId')}
                readOnly={editing}
                required
                maxLength={128}
              />
            </label>
            <div className="field">
              <label htmlFor="frame-status">Status (required)</label>
              <select id="frame-status" {...register('status')} required>
                <option value="" disabled>
                  Choose a status
                </option>
                {FRAME_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </select>
            </div>
            <label className="field">
              Status reason
              <input {...register('statusReason')} />
            </label>
            <label className="field">
              Site number
              <input {...register('siteNo')} />
            </label>
            <label className="field">
              Environment
              <input {...register('environment')} />
            </label>
            <label className="field">
              Address
              <input {...register('address')} />
            </label>
          </fieldset>
          <fieldset className="fields" disabled={fieldsDisabled}>
            <legend>Location</legend>
            <p className="subtle">Complete all four fields to add a location.</p>
            <label className="field">
              Country code
              <input {...register('countryCode')} maxLength={2} pattern="[A-Za-z]{2}" placeholder="GB" />
            </label>
            <label className="field">
              Region
              <input {...register('region')} maxLength={128} />
            </label>
            <label className="field">
              Town
              <input {...register('town')} maxLength={128} />
            </label>
            <label className="field">
              Postcode
              <input {...register('postcode')} maxLength={32} />
            </label>
          </fieldset>
          <fieldset className="fields" disabled={fieldsDisabled}>
            <legend>Format</legend>
            <p className="subtle">Complete all three fields to add a format.</p>
            <div className="field">
              <label htmlFor="frame-technology">Technology</label>
              <select id="frame-technology" {...register('technology')}>
                <option value="">Choose a technology</option>
                {FRAME_TECHNOLOGIES.map((technology) => (
                  <option key={technology} value={technology}>
                    {label(technology)}
                  </option>
                ))}
              </select>
            </div>
            <label className="field">
              Format code
              <input {...register('formatCode')} maxLength={128} />
            </label>
            <label className="field">
              Size group code
              <input {...register('sizeGroupCode')} maxLength={128} />
            </label>
          </fieldset>
          <fieldset className="fields" disabled={fieldsDisabled}>
            <legend>Commercial</legend>
            <label className="field">
              Number of slots
              <input
                {...register('numberOfSlots')}
                type="number"
                min={0}
                max={MAX_SLOTS}
                step={1}
              />
            </label>
            <label className="field">
              Impact weight
              <input {...register('impactWeight')} inputMode="decimal" maxLength={128} />
            </label>
            <label className="field">
              Pricing grade
              <input {...register('pricingGrade')} />
            </label>
            <label className="field">
              Production rate card
              <input {...register('productionRateCard')} />
            </label>
            <label className="field">
              Legacy production rate card
              <input {...register('productionRateCardLegacy')} />
            </label>
            <label className="check">
              <input {...register('premium')} type="checkbox" />
              Premium
            </label>
          </fieldset>
          {submitError && (
            <p className="error" role="alert">
              {submitError}
            </p>
          )}
          {conflict && (
            <div className="fields" role="alert">
              <p className="error">
                This frame changed while you were editing. Reload the latest version to continue.
                Your unsaved edits will be replaced.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={reload}
                  disabled={details.loading}
                >
                  {details.loading ? 'Reloading…' : 'Reload latest version'}
                </button>
              </div>
            </div>
          )}
          <div className="actions">
            <button
              type="submit"
              className="button button-primary"
              disabled={fieldsDisabled || conflict || Boolean(loadError)}
            >
              {editing
                ? saving
                  ? 'Saving changes…'
                  : 'Save changes'
                : saving
                  ? 'Creating frame…'
                  : 'Create frame'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
