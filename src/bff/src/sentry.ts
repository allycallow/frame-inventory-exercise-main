import type { ApolloServerPlugin } from '@apollo/server'
import * as Sentry from '@sentry/node'
import { GRAPHQL_ERROR_CODES } from './consts'
import { logger } from './logger'
import type { RequestContext } from './request-context'

const dsn = process.env.SENTRY_DSN
if (dsn) {
  Sentry.init({
    dsn,
    beforeSend(event) {
      delete event.request
      delete event.breadcrumbs
      return event
    },
  })
}

function captureException(error: Error, correlationId?: string) {
  Sentry.withScope((scope) => {
    if (correlationId) scope.setTag('correlationId', correlationId)
    Sentry.captureException(error)
  })
}

export const sentryPlugin: ApolloServerPlugin<RequestContext> = {
  async requestDidStart() {
    const startedAt = performance.now()
    return {
      async didEncounterErrors({ contextValue, errors, operationName }) {
        const { correlationId } = contextValue
        const durationMs = performance.now() - startedAt
        for (const error of errors) {
          const code = error.extensions.code
          const unavailable = code === GRAPHQL_ERROR_CODES.SERVICE_UNAVAILABLE
          const unexpected =
            code === GRAPHQL_ERROR_CODES.INTERNAL_SERVER_ERROR ||
            (code === undefined && Boolean(error.path))
          const level = unexpected ? 'error' : unavailable ? 'warn' : 'debug'
          logger[level](
            { correlationId, operationName, code, durationMs },
            'GraphQL operation failed',
          )
          if (unexpected || unavailable) {
            captureException(error.originalError ?? error, correlationId)
          }
        }
      },
    }
  },
  async unexpectedErrorProcessingRequest({ error, requestContext }) {
    const { contextValue, operationName } = requestContext
    const { correlationId } = contextValue
    logger.error(
      {
        correlationId,
        operationName,
        code: GRAPHQL_ERROR_CODES.INTERNAL_SERVER_ERROR,
      },
      'GraphQL request processing failed',
    )
    captureException(error, correlationId)
  },
}
