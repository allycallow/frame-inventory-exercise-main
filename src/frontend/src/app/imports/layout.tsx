import { connection } from 'next/server'
import type { ReactElement, ReactNode } from 'react'
import { ImportUpload } from './import-upload'

export default async function ImportsLayout({ children }: { children: ReactNode }): Promise<ReactElement> {
  await connection()
  const importsDisabled = process.env.LOCAL_IMPORTS_ENABLED === ''

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Imports</h1>
          {!importsDisabled && (
            <p className="subtle">Upload inventory CSV files and review import results.</p>
          )}
        </div>
      </div>
      {importsDisabled ? (
        <p className="card panel-message" role="status">
          CSV imports are disabled because the local import token is missing.
          Run <code>just up</code> from the repository root to enable them.
        </p>
      ) : (
        <div className="import-layout">
          <ImportUpload />
          {children}
        </div>
      )}
    </>
  )
}
