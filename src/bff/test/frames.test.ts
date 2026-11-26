import { Metadata, status } from '@grpc/grpc-js'
import { expect, jest, test } from '@jest/globals'
import type { FrameClient } from '../src/frame-client'
import type { Frame__Output } from '../src/generated/frameinventory/v1/Frame'
import type { ListFramesResponse__Output } from '../src/generated/frameinventory/v1/ListFramesResponse'
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
      (_request, _options, callback) => callback(null, page),
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

test('frames retries an unavailable gRPC call with the same deadline', async () => {
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
      .mockImplementationOnce((_request, _options, callback) => callback(error))
      .mockImplementation((_request, _options, callback) =>
        callback(null, page),
      ),
  }
  const server = createServer(client)

  try {
    const response = await server.executeOperation({
      query: '{ frames { page size hasNext } }',
    })

    expect(client.listFrames).toHaveBeenCalledTimes(2)
    const [, firstOptions] = client.listFrames.mock.calls[0]
    const [, retryOptions] = client.listFrames.mock.calls[1]
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
        (_request, _options, callback) => callback(error),
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
  client.getFrame.mockImplementation((_request, _options, callback) =>
    callback(null, frame),
  )
  client.getFrameHistory.mockImplementation((_request, _options, callback) =>
    callback(null, { versions: [frame] }),
  )
  client.createFrame.mockImplementation((_request, _options, callback) =>
    callback(null, frame),
  )
  client.updateFrame.mockImplementation((_request, _options, callback) =>
    callback(null, {
      ...frame,
      attributes: { ...frame.attributes, status: 'MAINTENANCE' },
    }),
  )
  client.deleteFrame.mockImplementation((_request, _options, callback) =>
    callback(null, {}),
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
    client.updateFrame.mockImplementation((_request, _options, callback) =>
      callback(error),
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
