import { ApolloServer } from '@apollo/server'
import { loadFilesSync } from '@graphql-tools/load-files'
import type { DocumentNode } from 'graphql'
import { join } from 'node:path'
import type { FrameClient } from './frame-client'
import { logger } from './logger'
import { createFrameResolvers } from './resolvers/frames'
import { sentryPlugin } from './sentry'

export function createServer(client: FrameClient) {
  const typeDefs = loadFilesSync<DocumentNode>(join(__dirname, '../schema'), {
    extensions: ['gql'],
  })

  return new ApolloServer({
    typeDefs,
    logger,
    plugins: [
      sentryPlugin,
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
