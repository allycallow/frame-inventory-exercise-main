import type { ReactElement, ReactNode } from 'react'
import { connection } from 'next/server'
import { InventoryApolloProvider } from './apollo-provider'
import { InventoryWorkspace } from './inventory-workspace'
import './globals.css'

export const metadata = {
  title: 'Frame Inventory',
  icons: { icon: '/favicon.svg' },
}

export default async function RootLayout({ children }: { children: ReactNode }): Promise<ReactElement> {
  await connection()
  const importsDisabled = process.env.LOCAL_IMPORTS_ENABLED === ''

  return (
    <html lang="en">
      <body>
        <InventoryApolloProvider>
          <InventoryWorkspace importsDisabled={importsDisabled}>{children}</InventoryWorkspace>
        </InventoryApolloProvider>
      </body>
    </html>
  )
}
