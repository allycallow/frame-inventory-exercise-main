import { Metadata, status } from '@grpc/grpc-js'
import { expect, jest, test } from '@jest/globals'
import type { FrameClient } from '../src/frame-client'
import type { ImportJob__Output } from '../src/generated/frameinventory/v1/ImportJob'
import {
  connectInventoryImport,
  type InventoryImportClient,
} from '../src/inventory-import-client'
import { createServer } from '../src/server'

const jobId = 'fdceefbf-7d49-4b54-a5a9-d432dfee8c36'
const contextValue = {
  correlationId: '87271cce-1966-4086-aca9-3e80643baba7',
  importAuthorization: `Bearer ${'a'.repeat(64)}`,
}
const job: ImportJob__Output = {
  jobId,
  mode: 'DELTA',
  status: 'AWAITING_UPLOAD',
  forceOverwrite: false,
  createdAt: { seconds: '1700000000', nanos: 0 },
  uploadExpiresAt: { seconds: '1700000900', nanos: 0 },
  finishedAt: null,
  rowsRead: 0,
  rowsApplied: 0,
  rowsUnchanged: 0,
  rowsRejected: 0,
  framesRetired: 0,
  failureCode: '',
}

function clients() {
  const frames: FrameClient = {
    listFrames: jest.fn(),
    getFrame: jest.fn(),
    getFrameHistory: jest.fn(),
    createFrame: jest.fn(),
    updateFrame: jest.fn(),
    deleteFrame: jest.fn(),
    close: jest.fn(),
  }
  const imports = {
    createImportJob: jest.fn<InventoryImportClient['createImportJob']>(),
    getImportJob: jest.fn<InventoryImportClient['getImportJob']>(),
    listImportRowErrors:
      jest.fn<InventoryImportClient['listImportRowErrors']>(),
    close: jest.fn(),
  }
  return { frames, imports }
}

test('creates a job and forwards the bearer, correlation, and signed PUT headers', async () => {
  const { frames, imports } = clients()
  imports.createImportJob.mockImplementation(
    (request, metadata, options, callback) => {
      expect(request).toEqual({ mode: undefined, forceOverwrite: true })
      expect(metadata.get('authorization')).toEqual([
        contextValue.importAuthorization,
      ])
      expect(metadata.get('x-correlation-id')).toEqual([
        contextValue.correlationId,
      ])
      expect(options.deadline).toEqual(expect.any(Number))
      callback(null, {
        job,
        uploadUrl: 'https://example.test/upload',
        uploadHeaders: { 'if-none-match': '*' },
      })
    },
  )
  const server = createServer(frames, imports)
  const result = await server.executeOperation(
    {
      query:
        'mutation { createImportJob(forceOverwrite: true) { job { jobId status createdAt } uploadUrl uploadHeaders { name value } } }',
    },
    { contextValue },
  )
  expect(result.body).toMatchObject({
    kind: 'single',
    singleResult: {
      data: {
        createImportJob: {
          job: {
            jobId,
            status: 'AWAITING_UPLOAD',
            createdAt: '2023-11-14T22:13:20.000Z',
          },
          uploadUrl: 'https://example.test/upload',
          uploadHeaders: [{ name: 'if-none-match', value: '*' }],
        },
      },
    },
  })
  expect(imports.createImportJob).toHaveBeenCalledTimes(1)
  await server.stop()
  expect(imports.close).toHaveBeenCalledTimes(1)
})

test('reads job status and passes paging arguments to the row-error RPC', async () => {
  const { frames, imports } = clients()
  imports.getImportJob.mockImplementation(
    (request, metadata, _options, callback) => {
      expect(request).toEqual({ jobId })
      expect(metadata.get('authorization')).toEqual([
        contextValue.importAuthorization,
      ])
      callback(null, job)
    },
  )
  imports.listImportRowErrors.mockImplementation(
    (request, metadata, _options, callback) => {
      expect(request).toEqual({ jobId, page: 1, size: 2 })
      expect(metadata.get('authorization')).toEqual([
        contextValue.importAuthorization,
      ])
      callback(null, {
        items: [
          {
            rowNumber: 7,
            code: 'INVALID_FIELD',
            frameId: 'F-1',
            detail: 'Invalid status',
          },
        ],
        page: 1,
        size: 2,
        hasNext: false,
      })
    },
  )
  const server = createServer(frames, imports)
  const result = await server.executeOperation(
    {
      query:
        'query ($id: ID!) { importJob(jobId: $id) { mode } importRowErrors(jobId: $id, page: 1, size: 2) { page items { rowNumber code frameId } hasNext } }',
      variables: { id: jobId },
    },
    { contextValue },
  )
  expect(result.body).toMatchObject({
    kind: 'single',
    singleResult: {
      data: {
        importJob: { mode: 'DELTA' },
        importRowErrors: {
          page: 1,
          items: [{ rowNumber: 7, code: 'INVALID_FIELD', frameId: 'F-1' }],
          hasNext: false,
        },
      },
    },
  })
  await server.stop()
})

test('rejects missing credentials and invalid input before calling the import service', async () => {
  const { frames, imports } = clients()
  const server = createServer(frames, imports)
  const missing = await server.executeOperation({
    query: '{ importJob(jobId: "a") { jobId } }',
  })
  expect(missing.body).toMatchObject({
    singleResult: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] },
  })
  const invalid = await server.executeOperation(
    {
      query:
        'query ($id: ID!) { importRowErrors(jobId: $id, size: 51) { size } }',
      variables: { id: jobId },
    },
    { contextValue },
  )
  expect(invalid.body).toMatchObject({
    singleResult: { errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] },
  })
  expect(imports.getImportJob).not.toHaveBeenCalled()
  expect(imports.listImportRowErrors).not.toHaveBeenCalled()
  await server.stop()
})

test('does not retry import mutations or forward import credentials to frame RPCs', async () => {
  const { frames, imports } = clients()
  imports.createImportJob.mockImplementation(
    (_request, _metadata, _options, callback) => {
      callback(
        Object.assign(new Error('Unavailable'), {
          code: status.UNAVAILABLE,
          details: '',
          metadata: new Metadata(),
        }),
      )
    },
  )
  const listFrames = jest.mocked(frames.listFrames)
  listFrames.mockImplementation((_request, metadata, _options, callback) => {
    expect(metadata.get('authorization')).toEqual([])
    callback(null, { items: [], page: 0, size: 25, hasNext: false })
  })
  const server = createServer(frames, imports)
  await server.executeOperation(
    {
      query: 'mutation { createImportJob { job { jobId } } }',
    },
    { contextValue },
  )
  expect(imports.createImportJob).toHaveBeenCalledTimes(1)
  const result = await server.executeOperation(
    { query: '{ frames { page } }' },
    { contextValue },
  )
  expect(result.body).toMatchObject({
    singleResult: { data: { frames: { page: 0 } } },
  })
  expect(listFrames).toHaveBeenCalledTimes(1)
  await server.stop()
})

test('disables imports without a configured client and rejects remote destinations', async () => {
  const { frames } = clients()
  const server = createServer(frames)
  const result = await server.executeOperation(
    {
      query: 'mutation { createImportJob { job { jobId } } }',
    },
    { contextValue },
  )
  expect(result.body).toMatchObject({
    singleResult: { errors: [{ extensions: { code: 'SERVICE_UNAVAILABLE' } }] },
  })
  expect(() => connectInventoryImport('backend:9090')).toThrow('127.0.0.1')
  await server.stop()
})
