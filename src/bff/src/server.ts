import { ApolloServer } from '@apollo/server'
import { loadFilesSync } from '@graphql-tools/load-files'
import type { DocumentNode } from 'graphql'
import { join } from 'node:path'
import type { FrameClient } from './frame-client'
import type { InventoryImportClient } from './inventory-import-client'
import { logger } from './logger'
import type { RequestContext } from './request-context'
import { createFrameResolvers } from './resolvers/frames'
import { createImportResolvers } from './resolvers/inventory-import'
import { sentryPlugin } from './sentry'

export function createServer(
  client: FrameClient,
  imports?: InventoryImportClient,
) {
  const typeDefs = loadFilesSync<DocumentNode>(join(__dirname, '../schema'), {
    extensions: ['gql'],
  })

  const frames = createFrameResolvers(client)
  const inventoryImport = createImportResolvers(imports)

  return new ApolloServer<RequestContext>({
    typeDefs,
    logger,
    plugins: [
      sentryPlugin,
      {
        async serverWillStart() {
          return {
            async serverWillStop() {
              client.close()
              imports?.close()
            },
          }
        },
      },
    ],
    includeStacktraceInErrorResponses: false,
    resolvers: {
      ...frames,
      Query: { ...frames.Query, ...inventoryImport.Query },
      Mutation: { ...frames.Mutation, ...inventoryImport.Mutation },
    },
  })
}
