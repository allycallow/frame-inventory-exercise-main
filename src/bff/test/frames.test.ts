import { Metadata, status } from '@grpc/grpc-js'
import { expect, jest, test } from '@jest/globals'
import {
  PrometheusExporter,
  PrometheusSerializer,
} from '@opentelemetry/exporter-prometheus'
import { MeterProvider } from '@opentelemetry/sdk-metrics'
import { Type } from 'protobufjs'
import type { FrameClient } from '../src/frame-client'
import type { Frame__Output } from '../src/generated/frameinventory/v1/Frame'
import type { ListFramesResponse__Output } from '../src/generated/frameinventory/v1/ListFramesResponse'
import { logger } from '../src/logger'
import { createMetricsPlugin } from '../src/metrics'
import { createServer } from '../src/server'

function mockClient() {
  return {
    listFrames: jest.fn<FrameClient['listFrames']>(),
    getFrame: jest.fn<FrameClient['getFrame']>(),
    getFrameHistory: jest.fn<FrameClient['getFrameHistory']>(),
    createFrame: jest.fn<FrameClient['createFrame']>(),
    updateFrame: jest.fn<FrameClient['updateFrame']>(),
    deleteFrame: jest.fn<FrameClient['deleteFrame']>(),
    close: jest.fn(),
  }
}

const statusType = Type.fromJSON('Status', {
  fields: {
    code: { type: 'int32', id: 1 },
    message: { type: 'string', id: 2 },
    details: { rule: 'repeated', type: 'Any', id: 3 },
  },
  nested: {
    Any: {
      fields: {
        typeUrl: { type: 'string', id: 1 },
        value: { type: 'bytes', id: 2 },
      },
    },
  },
})
const badRequestType = Type.fromJSON('BadRequest', {
  fields: {
    fieldViolations: { rule: 'repeated', type: 'FieldViolation', id: 1 },
  },
  nested: {
    FieldViolation: {
      fields: {
        field: { type: 'string', id: 1 },
        description: { type: 'string', id: 2 },
      },
    },
  },
})

test('exposes backend field violations from gRPC status details', async () => {
  const violations = [
    { field: 'attributes.latitude', description: 'must be at most 90' },
    { field: 'attributes.pixelWidth', description: 'must be positive' },
  ]
  const metadata = new Metadata()
  metadata.set(
    'grpc-status-details-bin',
    Buffer.from(
      statusType
        .encode({
          code: status.INVALID_ARGUMENT,
          message: 'One or more request values are invalid.',
          details: [
            {
              typeUrl: 'type.googleapis.com/google.rpc.ErrorInfo',
              value: [0xff],
            },
            {
              typeUrl: 'type.googleapis.com/google.rpc.BadRequest',
              value: badRequestType
                .encode({ fieldViolations: violations })
                .finish(),
            },
          ],
        })
        .finish(),
    ),
  )
  const client = mockClient()
  client.createFrame.mockImplementation(
    (_request, _metadata, _options, callback) =>
      callback(
        Object.assign(new Error('invalid'), {
          code: status.INVALID_ARGUMENT,
          details: 'One or more request values are invalid.',
          metadata,
        }),
      ),
  )
  const server = createServer(client)
  try {
    const response = await server.executeOperation({
      query:
        'mutation { createFrame(frameId: "frame", attributes: { status: LIVE }) { frameId } }',
    })
    expect(response.body).toMatchObject({
      kind: 'single',
      singleResult: {
        errors: [
          {
            message: 'One or more request values are invalid.',
            extensions: { code: 'BAD_USER_INPUT', fieldViolations: violations },
          },
        ],
      },
    })
  } finally {
    await server.stop()
  }
})

test.each([
  { name: 'missing', trailer: undefined },
  { name: 'malformed status', trailer: Buffer.from([0x1a, 0xff]) },
  {
    name: 'unrelated detail',
    trailer: Buffer.from(
      statusType
        .encode({
          details: [
            { typeUrl: 'type.googleapis.com/google.rpc.ErrorInfo', value: [] },
          ],
        })
        .finish(),
    ),
  },
  {
    name: 'malformed BadRequest',
    trailer: Buffer.from(
      statusType
        .encode({
          details: [
            {
              typeUrl: 'type.googleapis.com/google.rpc.BadRequest',
              value: [0x0a, 0xff],
            },
          ],
        })
        .finish(),
    ),
  },
])('ignores $name validation trailers', async ({ trailer }) => {
  const metadata = new Metadata()
  if (trailer) metadata.set('grpc-status-details-bin', trailer)
  const client = mockClient()
  client.createFrame.mockImplementation(
    (_request, _metadata, _options, callback) =>
      callback(
        Object.assign(new Error('invalid'), {
          code: status.INVALID_ARGUMENT,
          details: 'invalid input',
          metadata,
        }),
      ),
  )
  const server = createServer(client)
  try {
    const response = await server.executeOperation({
      query:
        'mutation { createFrame(frameId: "frame", attributes: { status: LIVE }) { frameId } }',
    })
    if (response.body.kind !== 'single') throw new Error('Unexpected response')
    expect(response.body.singleResult.errors?.[0].extensions).toEqual({
      code: 'BAD_USER_INPUT',
    })
  } finally {
    await server.stop()
  }
})

test('exports GraphQL successes and errors as distinct Prometheus samples', async () => {
  const exporter = new PrometheusExporter({ preventServerStart: true })
  const provider = new MeterProvider({ readers: [exporter] })
  const server = createServer(mockClient())
  server.addPlugin(
    createMetricsPlugin(provider.getMeter('frame-inventory-bff')),
  )

  try {
    await server.executeOperation({ query: 'query ClientLabel { __typename }' })
    await server.executeOperation({ query: '{ frames(page: -1) { page } }' })
    await server.executeOperation({ query: '{ missingField }' })

    const { resourceMetrics } = await exporter.collect()
    const samples = new PrometheusSerializer().serialize(resourceMetrics)
    expect(samples).toMatch(
      /bff_graphql_request_duration_seconds_count\{[^\n]*operation_type="query"[^\n]*outcome="success"[^\n]*\} 1\n/,
    )
    expect(samples).toMatch(
      /bff_graphql_request_duration_seconds_count\{[^\n]*operation_type="query"[^\n]*outcome="error"[^\n]*\} 1\n/,
    )
    expect(samples).toMatch(
      /bff_graphql_request_duration_seconds_count\{[^\n]*operation_type="unknown"[^\n]*outcome="error"[^\n]*\} 1\n/,
    )
    expect(samples).toMatch(/bff_graphql_requests_in_flight\{[^\n]*\} 0\n/)
    expect(samples).toContain('bff_nodejs_event_loop_time_seconds_total{')
    expect(samples).not.toContain('ClientLabel')
  } finally {
    await server.stop()
    await provider.shutdown()
  }
})

test('exports resolver latency by schema field for queries and mutations', async () => {
  const exporter = new PrometheusExporter({ preventServerStart: true })
  const provider = new MeterProvider({ readers: [exporter] })
  const client = mockClient()
  client.listFrames.mockImplementation(
    (_request, _metadata, _options, callback) => {
      callback(null, { items: [], page: 0, size: 25, hasNext: false })
    },
  )
  client.deleteFrame.mockImplementation(
    (_request, _metadata, _options, callback) => {
      callback(null, {})
    },
  )
  const server = createServer(client)
  server.addPlugin(
    createMetricsPlugin(provider.getMeter('frame-inventory-bff')),
  )

  try {
    await server.executeOperation({
      query: `query ClientQuery {
        aliasedFrames: frames { page }
        frame(frameId: "") { frameId }
        __typename
        secondList: frames(page: -1) { page }
      }`,
    })
    await server.executeOperation({
      query: `mutation ClientMutation {
        aliasedDelete: deleteFrame(frameId: "FRAME-001")
      }`,
    })

    const { resourceMetrics } = await exporter.collect()
    const samples = new PrometheusSerializer().serialize(resourceMetrics)
    const counts = samples
      .split('\n')
      .filter((line) =>
        line.startsWith('bff_graphql_root_field_duration_seconds_count{'),
      )
    expect(counts).toHaveLength(3)
    expect(counts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/operation_type="query".*field="frames".*\} 2$/),
        expect.stringMatching(/operation_type="query".*field="frame".*\} 1$/),
        expect.stringMatching(
          /operation_type="mutation".*field="deleteFrame".*\} 1$/,
        ),
      ]),
    )
    expect(samples).not.toMatch(
      /ClientQuery|ClientMutation|aliasedFrames|aliasedDelete|FRAME-001/,
    )
  } finally {
    await server.stop()
    await provider.shutdown()
  }
})

test('frames requests the specified gRPC page and returns frames with pagination metadata', async () => {
  const frame = {
    frameId: 'FRAME-001',
    versionId: '9007199254740993',
    attributes: { status: 'LIVE', address: '10 Test Street' },
  }
  const pagination = { page: 1, size: 1, hasNext: true }
  const page: ListFramesResponse__Output = {
    ...pagination,
    items: [
      {
        ...frame,
        attributes: {
          ...frame.attributes,
          location: null,
          format: null,
          premium: false,
        },
        validFrom: null,
        validTo: null,
        current: true,
        externalReferences: {},
        linkedFrameIds: [],
      },
    ],
  }
  const client = {
    ...mockClient(),
    listFrames: jest.fn<FrameClient['listFrames']>(
      (_request, _metadata, _options, callback) => callback(null, page),
    ),
  }
  const server = createServer(client)

  try {
    const response = await server.executeOperation({
      query: `
        query {
          frames(page: 1, size: 1) {
            items {
              frameId
              versionId
              attributes {
                status
                address
              }
            }
            page
            size
            hasNext
          }
        }
      `,
    })

    expect(client.listFrames).toHaveBeenCalledTimes(1)
    expect(client.listFrames).toHaveBeenCalledWith(
      { page: 1, size: 1 },
      expect.any(Metadata),
      { deadline: expect.any(Number) },
      expect.any(Function),
    )
    expect(response.body).toMatchObject({
      kind: 'single',
      singleResult: {
        data: { frames: { ...pagination, items: [frame] } },
        errors: undefined,
      },
    })
  } finally {
    await server.stop()
  }
})

test.each([
  { args: { page: -1 }, message: 'Page must be 0 or greater.' },
  { args: { size: 0 }, message: 'Size must be between 1 and 50.' },
  { args: { size: 51 }, message: 'Size must be between 1 and 50.' },
])('frames rejects $args before calling gRPC', async ({ args, message }) => {
  const client = mockClient()
  const server = createServer(client)

  try {
    const response = await server.executeOperation({
      query: `
        query ($page: Int, $size: Int) {
          frames(page: $page, size: $size) {
            page
          }
        }
      `,
      variables: args,
    })

    expect(response.body).toMatchObject({
      kind: 'single',
      singleResult: {
        data: null,
        errors: [{ message, extensions: { code: 'BAD_USER_INPUT' } }],
      },
    })
    expect(client.listFrames).not.toHaveBeenCalled()
  } finally {
    await server.stop()
  }
})

test('frames retries an unavailable gRPC call with the same deadline and correlation ID', async () => {
  const page = { items: [], page: 0, size: 25, hasNext: false }
  const error = Object.assign(new Error('Unavailable'), {
    code: status.UNAVAILABLE,
    details: 'Unavailable',
    metadata: new Metadata(),
  })
  const client = {
    ...mockClient(),
    listFrames: jest
      .fn<FrameClient['listFrames']>()
      .mockImplementationOnce((_request, _metadata, _options, callback) =>
        callback(error),
      )
      .mockImplementation((_request, _metadata, _options, callback) =>
        callback(null, page),
      ),
  }
  const server = createServer(client)

  try {
    const correlationId = '69b8e848-c107-42dd-9f38-646f1497b3de'
    const response = await server.executeOperation(
      { query: '{ frames { page size hasNext } }' },
      { contextValue: { correlationId } },
    )

    expect(client.listFrames).toHaveBeenCalledTimes(2)
    const [, firstMetadata, firstOptions] = client.listFrames.mock.calls[0]
    const [, retryMetadata, retryOptions] = client.listFrames.mock.calls[1]
    expect(firstMetadata.get('x-correlation-id')).toEqual([correlationId])
    expect(retryMetadata.get('x-correlation-id')).toEqual(
      firstMetadata.get('x-correlation-id'),
    )
    expect(retryOptions.deadline).toBe(firstOptions.deadline)
    expect(response.body).toMatchObject({
      kind: 'single',
      singleResult: {
        data: { frames: { page: 0, size: 25, hasNext: false } },
        errors: undefined,
      },
    })
  } finally {
    await server.stop()
  }
})

test.each([
  { grpcStatus: status.UNAVAILABLE, code: 'SERVICE_UNAVAILABLE', calls: 3 },
  {
    grpcStatus: status.DEADLINE_EXCEEDED,
    code: 'SERVICE_UNAVAILABLE',
    calls: 1,
  },
  { grpcStatus: status.INVALID_ARGUMENT, code: 'BAD_USER_INPUT', calls: 1 },
])(
  'frames handles gRPC status $grpcStatus after $calls calls',
  async ({ grpcStatus, code, calls }) => {
    const error = Object.assign(new Error('gRPC failure'), {
      code: grpcStatus,
      details: 'gRPC failure',
      metadata: new Metadata(),
    })
    const client = {
      ...mockClient(),
      listFrames: jest.fn<FrameClient['listFrames']>(
        (_request, _metadata, _options, callback) => callback(error),
      ),
    }
    const server = createServer(client)

    try {
      const response = await server.executeOperation({
        query: '{ frames { page } }',
      })
      expect(client.listFrames).toHaveBeenCalledTimes(calls)
      expect(response.body).toMatchObject({
        kind: 'single',
        singleResult: {
          data: null,
          errors: [{ extensions: { code } }],
        },
      })
    } finally {
      await server.stop()
    }
  },
)

test('frame reads and mutations forward the gRPC contract', async () => {
  const frame = {
    frameId: 'FRAME-001',
    versionId: '9007199254740993',
    validFrom: { seconds: '1704067200', nanos: 123_456_000 },
    validTo: null,
    current: true,
    changeSource: 'MANUAL_CREATE',
    attributes: {
      status: 'LIVE',
      premium: false,
      location: null,
      format: null,
    },
    externalReferences: { broadsign: '123' },
    linkedFrameIds: ['FRAME-002'],
  } satisfies Frame__Output
  const client = mockClient()
  client.getFrame.mockImplementation(
    (_request, _metadata, _options, callback) => callback(null, frame),
  )
  client.getFrameHistory.mockImplementation(
    (_request, _metadata, _options, callback) =>
      callback(null, { versions: [frame] }),
  )
  client.createFrame.mockImplementation(
    (_request, _metadata, _options, callback) => callback(null, frame),
  )
  client.updateFrame.mockImplementation(
    (_request, _metadata, _options, callback) =>
      callback(null, {
        ...frame,
        attributes: { ...frame.attributes, status: 'MAINTENANCE' },
      }),
  )
  client.deleteFrame.mockImplementation(
    (_request, _metadata, _options, callback) => callback(null, {}),
  )
  const server = createServer(client)

  try {
    const reads = await server.executeOperation({
      query: `{
        frame(frameId: "FRAME-001") {
          versionId validFrom validTo current changeSource
          externalReferences { key value }
          linkedFrameIds
        }
        frameHistory(frameId: "FRAME-001") { versionId }
      }`,
    })
    expect(reads.body).toMatchObject({
      kind: 'single',
      singleResult: {
        errors: undefined,
        data: {
          frame: {
            versionId: frame.versionId,
            validFrom: '2024-01-01T00:00:00.123456000Z',
            validTo: null,
            current: true,
            changeSource: 'MANUAL_CREATE',
            externalReferences: [{ key: 'broadsign', value: '123' }],
            linkedFrameIds: ['FRAME-002'],
          },
          frameHistory: [{ versionId: frame.versionId }],
        },
      },
    })
    expect(client.getFrame.mock.calls[0][0]).toEqual({ frameId: frame.frameId })
    expect(client.getFrameHistory.mock.calls[0][0]).toEqual({
      frameId: frame.frameId,
    })

    const writes = await server.executeOperation({
      query: `mutation ($id: ID!, $version: String!) {
        createFrame(frameId: $id, attributes: { status: LIVE, premium: false, distanceToClosestSchool: 0 }) { versionId }
        updateFrame(frameId: $id, expectedVersionId: $version, attributes: { status: MAINTENANCE, address: null }) { attributes { status address } }
        deleteFrame(frameId: $id, expectedVersionId: $version)
        deleteWithoutVersion: deleteFrame(frameId: $id)
      }`,
      variables: { id: frame.frameId, version: frame.versionId },
    })
    expect(writes.body).toMatchObject({
      kind: 'single',
      singleResult: {
        errors: undefined,
        data: {
          createFrame: { versionId: frame.versionId },
          updateFrame: { attributes: { status: 'MAINTENANCE', address: null } },
          deleteFrame: true,
          deleteWithoutVersion: true,
        },
      },
    })
    expect(client.createFrame.mock.calls[0][0]).toMatchObject({
      frameId: frame.frameId,
      attributes: {
        status: 'LIVE',
        premium: false,
        distanceToClosestSchool: 0,
      },
    })
    expect(client.updateFrame.mock.calls[0][0]).toMatchObject({
      frameId: frame.frameId,
      expectedVersionId: frame.versionId,
      attributes: { status: 'MAINTENANCE', address: undefined },
    })
    expect(client.deleteFrame.mock.calls.map(([request]) => request)).toEqual([
      { frameId: frame.frameId, expectedVersionId: frame.versionId },
      { frameId: frame.frameId, expectedVersionId: undefined },
    ])
  } finally {
    await server.stop()
  }
})

test.each([
  {
    query: '{ frame(frameId: " ") { frameId } }',
    method: 'getFrame',
  },
  {
    query:
      'mutation { deleteFrame(frameId: "frame", expectedVersionId: "9223372036854775808") }',
    method: 'deleteFrame',
  },
  {
    query:
      'mutation { updateFrame(frameId: "frame", expectedVersionId: "0", attributes: { status: LIVE }) { frameId } }',
    method: 'updateFrame',
  },
] as const)(
  'rejects invalid input before calling $method',
  async ({ query, method }) => {
    const client = mockClient()
    const server = createServer(client)

    try {
      const response = await server.executeOperation({ query })
      expect(response.body).toMatchObject({
        kind: 'single',
        singleResult: { errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] },
      })
      expect(client[method]).not.toHaveBeenCalled()
    } finally {
      await server.stop()
    }
  },
)

test.each([
  { grpcStatus: status.NOT_FOUND, code: 'NOT_FOUND' },
  { grpcStatus: status.ALREADY_EXISTS, code: 'ALREADY_EXISTS' },
  { grpcStatus: status.ABORTED, code: 'CONFLICT' },
  { grpcStatus: status.UNAVAILABLE, code: 'SERVICE_UNAVAILABLE' },
])(
  'maps mutation status $grpcStatus to $code without a retry',
  async ({ grpcStatus, code }) => {
    const client = mockClient()
    const error = Object.assign(new Error('gRPC failure'), {
      code: grpcStatus,
      details: 'gRPC failure',
      metadata: new Metadata(),
    })
    client.updateFrame.mockImplementation(
      (_request, _metadata, _options, callback) => callback(error),
    )
    const server = createServer(client)

    try {
      const response = await server.executeOperation({
        query:
          'mutation { updateFrame(frameId: "frame", expectedVersionId: "1", attributes: { status: LIVE }) { frameId } }',
      })
      expect(response.body).toMatchObject({
        kind: 'single',
        singleResult: { errors: [{ extensions: { code } }] },
      })
      expect(client.updateFrame).toHaveBeenCalledTimes(1)
    } finally {
      await server.stop()
    }
  },
)

test('logs unexpected GraphQL failures with operation and correlation context', async () => {
  const client = mockClient()
  const cause = 'private upstream details'
  client.listFrames.mockImplementation(
    (_request, _metadata, _options, callback) =>
      callback(
        Object.assign(new Error(cause), {
          code: status.UNKNOWN,
          details: cause,
          metadata: new Metadata(),
        }),
      ),
  )
  const server = createServer(client)
  const errorLog = jest.spyOn(logger, 'error').mockImplementation(() => {})
  const correlationId = '069aa868-7443-4787-8b47-e56fbc6077dd'

  try {
    const response = await server.executeOperation(
      { query: 'query ListInventory { frames { page } }' },
      { contextValue: { correlationId } },
    )

    expect(response.body).toMatchObject({
      kind: 'single',
      singleResult: {
        errors: [{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
      },
    })
    expect(errorLog).toHaveBeenCalledWith(
      {
        correlationId,
        operationName: 'ListInventory',
        code: 'INTERNAL_SERVER_ERROR',
        durationMs: expect.any(Number),
      },
      'GraphQL operation failed',
    )
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(cause)
  } finally {
    errorLog.mockRestore()
    await server.stop()
  }
})
