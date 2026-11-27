'use client'

import { CombinedGraphQLErrors } from '@apollo/client/errors'
import { skipToken, useMutation, useQuery } from '@apollo/client/react'
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
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
  readCreateFrameInput,
  readUpdateFrameInput,
} from './frame-form-input'
import { errorMessage, label } from './inventory-api'

export function FrameDialog({
  frameId,
  onClose,
  onSaved,
}: {
  frameId?: string
  onClose: () => void
  onSaved: (frameId: string) => void
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const frameIdInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
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
  const [createFrame, { loading: creating }] = useMutation(CreateFrameDocument, {
    refetchQueries: [FramesDocument],
  })
  const [updateFrame, { loading: updating }] = useMutation(UpdateFrameDocument, {
    refetchQueries: [FramesDocument],
  })

  const editing = frameId !== undefined
  const current = (details.data ?? details.previousData)?.frame
  const frame = current?.current ? current : undefined
  const attributes = frame?.attributes
  const saving = creating || updating
  const fieldsDisabled = saving || details.loading
  const loadError = details.error
    ? errorMessage(details.error)
    : editing && !details.loading && !frame
      ? 'This frame no longer has a current version.'
      : ''

  useEffect(() => {
    const modal = dialog.current
    modal?.showModal()
    frameIdInput.current?.focus()
    return () => modal?.close()
  }, [])

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
        setError('')
      }
    } catch {
      // The query error is shown in the dialog.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (fieldsDisabled || conflict || loadError || (editing && !frame)) return
    setError('')
    const form = new FormData(event.currentTarget)
    const input = frame
      ? { mode: 'edit' as const, result: readUpdateFrameInput(form, frame) }
      : { mode: 'create' as const, result: readCreateFrameInput(form) }
    if ('error' in input.result) {
      setError(input.result.error)
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
        setError(errorMessage(error))
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
          key={frame?.versionId}
          className="frame-form fields"
          onSubmit={submit}
          aria-busy={fieldsDisabled}
        >
          <fieldset className="fields" disabled={fieldsDisabled}>
            <legend>Basics</legend>
            <label className="field">
              {editing ? 'Frame ID' : 'Frame ID (required)'}
              <input
                ref={frameIdInput}
                name="frameId"
                readOnly={editing}
                defaultValue={frame?.frameId}
                required
                maxLength={128}
              />
            </label>
            <div className="field">
              <label htmlFor="frame-status">Status (required)</label>
              <select
                id="frame-status"
                name="status"
                defaultValue={attributes?.status ?? ''}
                required
              >
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
              <input name="statusReason" defaultValue={attributes?.statusReason ?? ''} />
            </label>
            <label className="field">
              Site number
              <input name="siteNo" defaultValue={attributes?.siteNo ?? ''} />
            </label>
            <label className="field">
              Environment
              <input name="environment" defaultValue={attributes?.environment ?? ''} />
            </label>
            <label className="field">
              Address
              <input name="address" defaultValue={attributes?.address ?? ''} />
            </label>
          </fieldset>
          <fieldset className="fields" disabled={fieldsDisabled}>
            <legend>Location</legend>
            <p className="subtle">Complete all four fields to add a location.</p>
            <label className="field">
              Country code
              <input
                name="countryCode"
                maxLength={2}
                pattern="[A-Za-z]{2}"
                placeholder="GB"
                defaultValue={attributes?.location?.countryCode ?? ''}
              />
            </label>
            <label className="field">
              Region
              <input
                name="region"
                maxLength={128}
                defaultValue={attributes?.location?.region ?? ''}
              />
            </label>
            <label className="field">
              Town
              <input name="town" maxLength={128} defaultValue={attributes?.location?.town ?? ''} />
            </label>
            <label className="field">
              Postcode
              <input
                name="postcode"
                maxLength={32}
                defaultValue={attributes?.location?.postcode ?? ''}
              />
            </label>
          </fieldset>
          <fieldset className="fields" disabled={fieldsDisabled}>
            <legend>Format</legend>
            <p className="subtle">Complete all three fields to add a format.</p>
            <div className="field">
              <label htmlFor="frame-technology">Technology</label>
              <select
                id="frame-technology"
                name="technology"
                defaultValue={attributes?.format?.technology ?? ''}
              >
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
              <input
                name="formatCode"
                maxLength={128}
                defaultValue={attributes?.format?.formatCode ?? ''}
              />
            </label>
            <label className="field">
              Size group code
              <input
                name="sizeGroupCode"
                maxLength={128}
                defaultValue={attributes?.format?.sizeGroupCode ?? ''}
              />
            </label>
          </fieldset>
          <fieldset className="fields" disabled={fieldsDisabled}>
            <legend>Commercial</legend>
            <label className="field">
              Number of slots
              <input
                name="numberOfSlots"
                type="number"
                min={0}
                max={MAX_SLOTS}
                step={1}
                defaultValue={attributes?.numberOfSlots ?? ''}
              />
            </label>
            <label className="field">
              Impact weight
              <input
                name="impactWeight"
                inputMode="decimal"
                maxLength={128}
                defaultValue={attributes?.impactWeight ?? ''}
              />
            </label>
            <label className="field">
              Pricing grade
              <input name="pricingGrade" defaultValue={attributes?.pricingGrade ?? ''} />
            </label>
            <label className="field">
              Production rate card
              <input
                name="productionRateCard"
                defaultValue={attributes?.productionRateCard ?? ''}
              />
            </label>
            <label className="field">
              Legacy production rate card
              <input
                name="productionRateCardLegacy"
                defaultValue={attributes?.productionRateCardLegacy ?? ''}
              />
            </label>
            <label className="check">
              <input name="premium" type="checkbox" defaultChecked={attributes?.premium} />
              Premium
            </label>
          </fieldset>
          {error && (
            <p className="error" role="alert">
              {error}
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
