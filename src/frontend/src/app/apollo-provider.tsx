'use client'

import { HttpLink } from '@apollo/client'
import { ApolloClient, ApolloNextAppProvider, InMemoryCache } from '@apollo/client-integration-nextjs'
import type { ReactElement, ReactNode } from 'react'

function makeClient(): ApolloClient {
  return new ApolloClient({
    cache: new InMemoryCache(),
    link: new HttpLink({ uri: '/api/graphql' }),
  })
}

export function InventoryApolloProvider({ children }: { children: ReactNode }): ReactElement {
  return <ApolloNextAppProvider makeClient={makeClient}>{children}</ApolloNextAppProvider>
}
