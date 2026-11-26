import { ApolloServer } from '@apollo/server'
import { loadFilesSync } from '@graphql-tools/load-files'
import type { DocumentNode } from 'graphql'
import { join } from 'node:path'
import type { FrameClient } from './frame-client'
import { logger } from './logger'
import type { RequestContext } from './request-context'
import { createFrameResolvers } from './resolvers/frames'

export function createServer(client: FrameClient) {
  const typeDefs = loadFilesSync<DocumentNode>(join(__dirname, '../schema'), {
    extensions: ['gql'],
  })

  return new ApolloServer<RequestContext>({
    typeDefs,
    logger,
    plugins: [
      {
        async serverWillStart() {
          return {
            async serverWillStop() {
              client.close()
            },
          }
        },
      },
    ],
    includeStacktraceInErrorResponses: false,
    resolvers: createFrameResolvers(client),
  })
}
