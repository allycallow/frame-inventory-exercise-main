'use client'

import { useMutation } from '@apollo/client/react'
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { CreateFrameDocument, FramesDocument } from '../generated/graphql'
import {
  FRAME_STATUSES,
  FRAME_TECHNOLOGIES,
  MAX_SLOTS,
  readCreateFrameInput,
} from './create-frame-input'
import { errorMessage, label } from './inventory-api'

export function CreateFrameDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (frameId: string) => void
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const frameIdInput = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [createFrame, { loading }] = useMutation(CreateFrameDocument, {
    refetchQueries: [FramesDocument],
  })

  useEffect(() => {
    const modal = dialog.current
    modal?.showModal()
    frameIdInput.current?.focus()
    return () => modal?.close()
  }, [])

  function cancel(): void {
    if (loading) return
    dialog.current?.close()
    onClose()
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (loading) return
    setError('')
    const input = readCreateFrameInput(new FormData(event.currentTarget))
    if ('error' in input) {
      setError(input.error)
      return
    }
    try {
      const { data } = await createFrame({ variables: input.variables })
      if (!data) throw new Error('Inventory service returned no result.')
      dialog.current?.close()
      onCreated(data.createFrame.frameId)
    } catch (error) {
      setError(errorMessage(error))
    }
  }

  return (
    <dialog
      ref={dialog}
      className="create-frame-dialog"
      aria-labelledby="create-frame-title"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
    >
      <header className="drawer-header">
        <h2 id="create-frame-title">Add a frame</h2>
        <button type="button" className="button button-secondary" onClick={cancel} disabled={loading}>
          Cancel
        </button>
      </header>
      <form className="create-frame-form fields" onSubmit={submit} aria-busy={loading}>
        <fieldset className="fields" disabled={loading}>
          <legend>Basics</legend>
          <label className="field">
            Frame ID (required)
            <input ref={frameIdInput} name="frameId" required maxLength={128} />
          </label>
          <div className="field">
            <label htmlFor="create-frame-status">Status (required)</label>
            <select id="create-frame-status" name="status" defaultValue="" required>
              <option value="" disabled>Choose a status</option>
              {FRAME_STATUSES.map((status) => (
                <option key={status} value={status}>{label(status)}</option>
              ))}
            </select>
          </div>
          <label className="field">
            Status reason
            <input name="statusReason" />
          </label>
          <label className="field">
            Site number
            <input name="siteNo" />
          </label>
          <label className="field">
            Environment
            <input name="environment" />
          </label>
          <label className="field">
            Address
            <input name="address" />
          </label>
        </fieldset>
        <fieldset className="fields" disabled={loading}>
          <legend>Location</legend>
          <p className="subtle">Complete all four fields to add a location.</p>
          <label className="field">
            Country code
            <input name="countryCode" maxLength={2} pattern="[A-Za-z]{2}" placeholder="GB" />
          </label>
          <label className="field">
            Region
            <input name="region" maxLength={128} />
          </label>
          <label className="field">
            Town
            <input name="town" maxLength={128} />
          </label>
          <label className="field">
            Postcode
            <input name="postcode" maxLength={32} />
          </label>
        </fieldset>
        <fieldset className="fields" disabled={loading}>
          <legend>Format</legend>
          <p className="subtle">Complete all three fields to add a format.</p>
          <div className="field">
            <label htmlFor="create-frame-technology">Technology</label>
            <select id="create-frame-technology" name="technology" defaultValue="">
              <option value="">Choose a technology</option>
              {FRAME_TECHNOLOGIES.map((technology) => (
                <option key={technology} value={technology}>{label(technology)}</option>
              ))}
            </select>
          </div>
          <label className="field">
            Format code
            <input name="formatCode" maxLength={128} />
          </label>
          <label className="field">
            Size group code
            <input name="sizeGroupCode" maxLength={128} />
          </label>
        </fieldset>
        <fieldset className="fields" disabled={loading}>
          <legend>Commercial</legend>
          <label className="field">
            Number of slots
            <input name="numberOfSlots" type="number" min={0} max={MAX_SLOTS} step={1} />
          </label>
          <label className="field">
            Impact weight
            <input name="impactWeight" inputMode="decimal" />
          </label>
          <label className="field">
            Pricing grade
            <input name="pricingGrade" />
          </label>
          <label className="field">
            Production rate card
            <input name="productionRateCard" />
          </label>
          <label className="field">
            Legacy production rate card
            <input name="productionRateCardLegacy" />
          </label>
          <label className="check">
            <input name="premium" type="checkbox" />
            Premium
          </label>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={loading}>
            {loading ? 'Creating frame…' : 'Create frame'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
