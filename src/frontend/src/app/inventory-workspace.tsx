'use client'

import { usePathname } from 'next/navigation'
import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { FrameDialog } from './frame-dialog'
import { InventoryImport } from './inventory-import'
import { InventoryList } from './inventory-list'

type InventoryActions = {
  showImports: (jobId?: string) => void
  addFrame: () => void
}

const InventoryActionsContext = createContext<InventoryActions | null>(null)

export function useInventoryActions(): InventoryActions {
  const actions = useContext(InventoryActionsContext)
  if (!actions) throw new Error('Inventory actions require the inventory workspace.')
  return actions
}

export function FrameListActions(): ReactElement {
  const { showImports, addFrame } = useInventoryActions()
  return (
    <div className="actions">
      <button className="button button-secondary" onClick={() => showImports()}>
        Import CSV
      </button>
      <button className="button button-primary" onClick={addFrame}>
        Add a frame
      </button>
    </div>
  )
}

export function InventoryWorkspace({ children }: { children: ReactNode }): ReactElement {
  const showList = usePathname() === '/'
  const [area, setArea] = useState<'frames' | 'imports'>('frames')
  const [jobId, setJobId] = useState('')
  const [frameDialog, setFrameDialog] = useState<{ frameId?: string } | null>(null)
  const [savedFrame, setSavedFrame] = useState<{ frameId: string; action: 'created' | 'updated' } | null>(null)
  const showImports = useCallback((id?: string): void => {
    if (id) setJobId(id)
    setArea('imports')
  }, [])
  const actions = useMemo<InventoryActions>(() => ({
    showImports,
    addFrame: () => setFrameDialog({}),
  }), [showImports])

  return (
    <InventoryActionsContext.Provider value={actions}>
      <div className="workspace">
        <header className="workspace-rail">
          <div className="product">
            <span className="product-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="5" width="18" height="14" rx="1" />
                <path d="M3 9h18" />
              </svg>
            </span>
            Frame Inventory
          </div>
          <nav aria-label="Inventory navigation">
            <button
              aria-current={area === 'frames' ? 'page' : undefined}
              onClick={() => setArea('frames')}
            >
              Frames
            </button>
            <button
              aria-current={area === 'imports' ? 'page' : undefined}
              onClick={() => showImports()}
            >
              Imports
            </button>
          </nav>
        </header>
        <main>
          <section hidden={area !== 'frames'}>
            {area === 'frames' && (
              <>
                {children}
                <div hidden={!showList}>
                  {savedFrame && (
                    <p className="card panel-message frame-saved" role="status">
                      Frame <strong>{savedFrame.frameId}</strong> was {savedFrame.action}.
                    </p>
                  )}
                  <InventoryList active={showList} onEdit={(frameId) => setFrameDialog({ frameId })} />
                </div>
                {showList && frameDialog && (
                  <FrameDialog
                    frameId={frameDialog.frameId}
                    onClose={() => setFrameDialog(null)}
                    onSaved={(frameId) => {
                      setSavedFrame({ frameId, action: frameDialog.frameId === undefined ? 'created' : 'updated' })
                      setFrameDialog(null)
                    }}
                  />
                )}
              </>
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
      </div>
    </InventoryActionsContext.Provider>
  )
}
