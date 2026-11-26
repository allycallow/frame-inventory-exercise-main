import type { ApolloServerPlugin, GraphQLRequestContext } from '@apollo/server'
import type { Meter } from '@opentelemetry/api'
import { performance } from 'node:perf_hooks'

const durationBuckets = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]

export function createMetricsPlugin(meter: Meter): ApolloServerPlugin {
  const duration = meter.createHistogram(
    'bff_graphql_request_duration_seconds',
    {
      description: 'Time spent processing a GraphQL request in Apollo Server',
      unit: 's',
      advice: { explicitBucketBoundaries: durationBuckets },
    },
  )
  const resolverDuration = meter.createHistogram(
    'bff_graphql_root_field_duration_seconds',
    {
      description:
        'Time spent resolving a top-level GraphQL query or mutation field',
      unit: 's',
      advice: { explicitBucketBoundaries: durationBuckets },
    },
  )
  const inFlight = meter.createUpDownCounter('bff_graphql_requests_in_flight', {
    description: 'GraphQL requests currently being processed',
  })
  inFlight.add(0)

  meter
    .createObservableCounter('bff_nodejs_event_loop_time_seconds', {
      description: 'Time the Node.js event loop has spent active or idle',
      unit: 's',
    })
    .addCallback((result) => {
      const { active, idle } = performance.eventLoopUtilization()
      result.observe(active / 1000, { state: 'active' })
      result.observe(idle / 1000, { state: 'idle' })
    })

  const startTimes = new WeakMap<GraphQLRequestContext<object>, number>()

  function finish(
    requestContext: GraphQLRequestContext<object>,
    outcome: 'success' | 'error',
  ) {
    const startedAt = startTimes.get(requestContext)
    if (startedAt === undefined) return

    startTimes.delete(requestContext)
    inFlight.add(-1)
    duration.record((performance.now() - startedAt) / 1000, {
      operation_type: requestContext.operation?.operation ?? 'unknown',
      outcome,
    })
  }

  return {
    async requestDidStart(requestContext) {
      startTimes.set(requestContext, performance.now())
      inFlight.add(1)
      return {
        async executionDidStart({ operation }) {
          const operationType = operation.operation
          if (operationType !== 'query' && operationType !== 'mutation') return

          return {
            willResolveField({ info }) {
              if (info.path.prev || info.fieldName.startsWith('__')) return

              const startedAt = performance.now()
              return () => {
                resolverDuration.record(
                  (performance.now() - startedAt) / 1000,
                  {
                    operation_type: operationType,
                    field: info.fieldName,
                  },
                )
              }
            },
          }
        },
        async willSendResponse() {
          finish(
            requestContext,
            requestContext.errors?.length ? 'error' : 'success',
          )
        },
      }
    },
    async unexpectedErrorProcessingRequest({ requestContext }) {
      finish(requestContext, 'error')
    },
  }
}
