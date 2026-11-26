import type { ApolloServerPlugin } from '@apollo/server'
import * as Sentry from '@sentry/node'
import { GRAPHQL_ERROR_CODES } from './consts'

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

export const sentryPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didEncounterErrors({ errors }) {
        for (const error of errors) {
          const code = error.extensions.code
          if (
            code === GRAPHQL_ERROR_CODES.INTERNAL_SERVER_ERROR ||
            code === GRAPHQL_ERROR_CODES.SERVICE_UNAVAILABLE ||
            (code === undefined && error.path)
          ) {
            Sentry.captureException(error.originalError ?? error)
          }
        }
      },
    }
  },
  async unexpectedErrorProcessingRequest({ error }) {
    Sentry.captureException(error)
  },
}
