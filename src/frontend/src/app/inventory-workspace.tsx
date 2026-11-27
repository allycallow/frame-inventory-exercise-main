'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useState, type ReactElement, type ReactNode } from 'react'
import { FrameDialog } from './frame-dialog'

type OpenFrameDialog = (frameId: string | undefined, onSaved: (id: string) => void) => void
type ImportToken = { token: string; setToken: (token: string) => void }

const FrameDialogContext = createContext<OpenFrameDialog | null>(null)
const ImportTokenContext = createContext<ImportToken | null>(null)

export function useFrameDialog(): OpenFrameDialog {
  const openFrameDialog = useContext(FrameDialogContext)
  if (!openFrameDialog) throw new Error('The frame dialog requires the inventory workspace.')
  return openFrameDialog
}

export function useImportToken(): ImportToken {
  const importToken = useContext(ImportTokenContext)
  if (!importToken) throw new Error('Import authorization requires the inventory workspace.')
  return importToken
}

export function InventoryWorkspace({ children }: { children: ReactNode }): ReactElement {
  const pathname = usePathname()
  const [token, setToken] = useState('')
  const [frameDialog, setFrameDialog] = useState<{
    frameId: string | undefined
    pathname: string
    onSaved: (id: string) => void
  } | null>(null)

  if (frameDialog && frameDialog.pathname !== pathname) setFrameDialog(null)

  return (
    <FrameDialogContext.Provider value={(frameId, onSaved) => setFrameDialog({ frameId, pathname, onSaved })}>
      <ImportTokenContext.Provider value={{ token, setToken }}>
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
              <Link
                href="/frames"
                aria-current={pathname === '/frames' || pathname.startsWith('/frames/') ? 'page' : undefined}
              >
                Frames
              </Link>
              <Link
                href="/imports"
                aria-current={pathname === '/imports' || pathname.startsWith('/imports/') ? 'page' : undefined}
              >
                Imports
              </Link>
            </nav>
          </header>
          <main>{children}</main>
          {frameDialog && frameDialog.pathname === pathname && (
            <FrameDialog
              frameId={frameDialog.frameId}
              refetchFrameList={pathname === '/frames'}
              onClose={() => setFrameDialog(null)}
              onSaved={(id) => {
                setFrameDialog((current) => current === frameDialog ? null : current)
                frameDialog.onSaved(id)
              }}
            />
          )}
        </div>
      </ImportTokenContext.Provider>
    </FrameDialogContext.Provider>
  )
}
