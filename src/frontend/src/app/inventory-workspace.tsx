'use client'

import { useState, type ReactElement } from 'react'
import { FrameDialog } from './frame-dialog'
import { InventoryImport } from './inventory-import'
import { InventoryList } from './inventory-list'

export function InventoryWorkspace(): ReactElement {
  const [area, setArea] = useState<'frames' | 'imports'>('frames')
  const [jobId, setJobId] = useState('')
  const [frameDialog, setFrameDialog] = useState<{ frameId?: string } | null>(null)
  const [savedFrame, setSavedFrame] = useState<{ frameId: string; action: 'created' | 'updated' } | null>(null)

  return (
    <>
      <header className="masthead">
        <div className="masthead-content">
          <span className="product">Frame Inventory</span>
          <nav aria-label="Inventory navigation">
            <button
              aria-current={area === 'frames' ? 'page' : undefined}
              onClick={() => setArea('frames')}
            >
              Frames
            </button>
            <button
              aria-current={area === 'imports' ? 'page' : undefined}
              onClick={() => setArea('imports')}
            >
              Imports
            </button>
          </nav>
        </div>
      </header>
      <main>
        <section hidden={area !== 'frames'}>
          <div className="page-heading">
            <div>
              <h1>Frames</h1>
              <p className="subtle">Select a frame ID to view its version history.</p>
            </div>
            <div className="actions">
              <button className="button button-secondary" onClick={() => setArea('imports')}>
                Import CSV
              </button>
              <button className="button button-primary" onClick={() => setFrameDialog({})}>
                Add a frame
              </button>
            </div>
          </div>
          {savedFrame && (
            <p className="card panel-message frame-saved" role="status">
              Frame <strong>{savedFrame.frameId}</strong> was {savedFrame.action}.
            </p>
          )}
          {area === 'frames' && (
            <InventoryList
              onEdit={(frameId) => setFrameDialog({ frameId })}
              onJob={(id) => {
                setJobId(id)
                setArea('imports')
              }}
            />
          )}
          {frameDialog && (
            <FrameDialog
              frameId={frameDialog.frameId}
              onClose={() => setFrameDialog(null)}
              onSaved={(frameId) => {
                setSavedFrame({ frameId, action: frameDialog.frameId === undefined ? 'created' : 'updated' })
                setFrameDialog(null)
              }}
            />
          )}
        </section>
        <section hidden={area !== 'imports'}>
          <div className="page-heading">
            <div>
              <h1>Imports</h1>
              <p className="subtle">Upload inventory CSV files and review import results.</p>
            </div>
          </div>
          <InventoryImport trackedId={jobId} onTrack={setJobId} />
        </section>
      </main>
    </>
  )
}
