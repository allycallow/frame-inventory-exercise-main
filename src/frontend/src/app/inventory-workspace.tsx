'use client'

import { useState, type ReactElement } from 'react'
import { CreateFrameDialog } from './create-frame-dialog'
import { InventoryImport } from './inventory-import'
import { InventoryList } from './inventory-list'

export function InventoryWorkspace(): ReactElement {
  const [area, setArea] = useState<'frames' | 'imports'>('frames')
  const [jobId, setJobId] = useState('')
  const [creatingFrame, setCreatingFrame] = useState(false)
  const [createdFrame, setCreatedFrame] = useState<string | null>(null)

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
              <button className="button button-primary" onClick={() => setCreatingFrame(true)}>
                Add a frame
              </button>
            </div>
          </div>
          {createdFrame && (
            <p className="card panel-message frame-created" role="status">
              Frame <strong>{createdFrame}</strong> was created.
            </p>
          )}
          {area === 'frames' && (
            <InventoryList
              onJob={(id) => {
                setJobId(id)
                setArea('imports')
              }}
            />
          )}
          {creatingFrame && (
            <CreateFrameDialog
              onClose={() => setCreatingFrame(false)}
              onCreated={(frameId) => {
                setCreatedFrame(frameId)
                setCreatingFrame(false)
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
