'use client'

import Link from 'next/link'
import { useState, type ReactElement } from 'react'
import { InventoryList } from '../inventory-list'
import { useFrameDialog } from '../inventory-workspace'

export function FramesWorkspace(): ReactElement {
  const openFrameDialog = useFrameDialog()
  const [savedFrame, setSavedFrame] = useState<{ id: string; action: 'created' | 'updated' } | null>(null)

  return (
    <>
      <div className="page-heading">
        <h1>Frames</h1>
        <div className="actions">
          <Link href="/imports" className="button button-secondary">Import CSV</Link>
          <button
            className="button button-primary"
            onClick={() => openFrameDialog(undefined, (id) => setSavedFrame({ id, action: 'created' }))}
          >
            Add a frame
          </button>
        </div>
      </div>
      {savedFrame && (
        <p className="card panel-message frame-saved" role="status">
          Frame <strong>{savedFrame.id}</strong> was {savedFrame.action}.
        </p>
      )}
      <InventoryList
        onEdit={(frameId) => openFrameDialog(frameId, (id) => setSavedFrame({ id, action: 'updated' }))}
      />
    </>
  )
}
