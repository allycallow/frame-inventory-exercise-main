import type { ReactElement, ReactNode } from 'react'
import { InventoryApolloProvider } from './apollo-provider'
import { InventoryWorkspace } from './inventory-workspace'
import './globals.css'

export const metadata = {
  title: 'Frame Inventory',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <body>
        <InventoryApolloProvider>
          <InventoryWorkspace>{children}</InventoryWorkspace>
        </InventoryApolloProvider>
      </body>
    </html>
  )
}
