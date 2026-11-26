'use client'

import { useState, type ReactElement } from 'react'
import { InventoryImport } from './inventory-import'
import { InventoryList } from './inventory-list'

export function InventoryWorkspace(): ReactElement {
  const [area, setArea] = useState<'frames' | 'imports'>('frames')
  const [jobId, setJobId] = useState('')

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
            <button className="button button-primary" onClick={() => setArea('imports')}>
              Import CSV
            </button>
          </div>
          {area === 'frames' && (
            <InventoryList
              onJob={(id) => {
                setJobId(id)
                setArea('imports')
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
