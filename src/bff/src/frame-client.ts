import {
  Metadata,
  status,
  type CallOptions,
  type requestCallback,
  type ServiceError,
} from '@grpc/grpc-js'
import { ConstantBackoff, handleWhen, retry } from 'cockatiel'
import { GraphQLError } from 'graphql'
import { Type } from 'protobufjs'
import { GRAPHQL_ERROR_CODES } from './consts'
import type { CreateFrameRequest } from './generated/frameinventory/v1/CreateFrameRequest'
import type { DeleteFrameRequest } from './generated/frameinventory/v1/DeleteFrameRequest'
import type { Frame__Output } from './generated/frameinventory/v1/Frame'
import type { GetFrameHistoryRequest } from './generated/frameinventory/v1/GetFrameHistoryRequest'
import type { GetFrameHistoryResponse__Output } from './generated/frameinventory/v1/GetFrameHistoryResponse'
import type { GetFrameRequest } from './generated/frameinventory/v1/GetFrameRequest'
import type { ListFramesRequest } from './generated/frameinventory/v1/ListFramesRequest'
import type { ListFramesResponse__Output } from './generated/frameinventory/v1/ListFramesResponse'
import type { UpdateFrameRequest } from './generated/frameinventory/v1/UpdateFrameRequest'
import type { Empty__Output } from './generated/google/protobuf/Empty'
import { logger } from './logger'

type UnaryRpc<Request, Response> = (
  request: Request,
  options: CallOptions,
  callback: requestCallback<Response>,
) => void

export interface FrameClient {
  listFrames: UnaryRpc<ListFramesRequest, ListFramesResponse__Output>
  getFrame: UnaryRpc<GetFrameRequest, Frame__Output>
  getFrameHistory: UnaryRpc<
    GetFrameHistoryRequest,
    GetFrameHistoryResponse__Output
  >
  createFrame: UnaryRpc<CreateFrameRequest, Frame__Output>
  updateFrame: UnaryRpc<UpdateFrameRequest, Frame__Output>
  deleteFrame: UnaryRpc<DeleteFrameRequest, Empty__Output>
  close(): void
}

const TIMEOUT_MS = 5_000
const readRetry = retry(
  handleWhen(
    (error) => isGrpcError(error) && error.code === status.UNAVAILABLE,
  ),
  { maxAttempts: 2, backoff: new ConstantBackoff(100) },
)

const clientErrorCodes = new Map([
  [status.INVALID_ARGUMENT, GRAPHQL_ERROR_CODES.BAD_USER_INPUT],
  [status.NOT_FOUND, GRAPHQL_ERROR_CODES.NOT_FOUND],
  [status.ALREADY_EXISTS, GRAPHQL_ERROR_CODES.ALREADY_EXISTS],
  [status.ABORTED, GRAPHQL_ERROR_CODES.CONFLICT],
])

const statusDetailsType = Type.fromJSON('Status', {
  fields: {
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

function fieldViolations(
  error: unknown,
): { field: string; description: string }[] {
  if (
    !(error instanceof Error) ||
    !('metadata' in error) ||
    !(error.metadata instanceof Metadata)
  ) {
    return []
  }
  const trailer = error.metadata.get('grpc-status-details-bin')[0]
  if (!Buffer.isBuffer(trailer)) return []

  try {
    const decoded = statusDetailsType.decode(trailer) as unknown as {
      details?: { typeUrl?: string; value?: Uint8Array }[]
    }
    return (decoded.details ?? []).flatMap((detail) => {
      if (
        !detail.typeUrl?.endsWith('/google.rpc.BadRequest') ||
        !detail.value
      ) {
        return []
      }
      try {
        const badRequest = badRequestType.decode(detail.value) as unknown as {
          fieldViolations?: { field?: string; description?: string }[]
        }
        return (badRequest.fieldViolations ?? []).map((violation) => ({
          field: violation.field ?? '',
          description: violation.description ?? '',
        }))
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function isGrpcError(
  error: unknown,
): error is Pick<ServiceError, 'code' | 'details'> {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'number' &&
    'details' in error &&
    typeof error.details === 'string'
  )
}

export async function callFrameRpc<Request, Response>(
  method: string,
  rpc: UnaryRpc<Request, Response>,
  request: Request,
  retryUnavailable = false,
): Promise<Response> {
  const startedAt = performance.now()
  const deadline = Date.now() + TIMEOUT_MS
  const call = () =>
    new Promise<Response>((resolve, reject) => {
      rpc(request, { deadline }, (error, response) => {
        if (error) {
          reject(error)
        } else if (!response) {
          reject(new Error('gRPC returned no response'))
        } else {
          resolve(response)
        }
      })
    })

  try {
    const response = retryUnavailable
      ? await readRetry.execute(call, AbortSignal.timeout(TIMEOUT_MS))
      : await call()
    logger.debug(
      { method, durationMs: performance.now() - startedAt },
      'Frame RPC completed',
    )
    return response
  } catch (error) {
    const grpcError = isGrpcError(error) ? error : undefined

    if (grpcError) {
      const code = clientErrorCodes.get(grpcError.code)
      if (code) {
        logger.debug({ method, grpcCode: grpcError.code }, 'Frame RPC rejected')
        const violations =
          grpcError.code === status.INVALID_ARGUMENT
            ? fieldViolations(error)
            : []
        throw new GraphQLError(grpcError.details, {
          extensions: {
            code,
            ...(violations.length > 0 ? { fieldViolations: violations } : {}),
          },
        })
      }

      if (
        grpcError.code === status.UNAVAILABLE ||
        grpcError.code === status.DEADLINE_EXCEEDED
      ) {
        logger.warn(
          { method, grpcCode: grpcError.code },
          'Frame service is unavailable',
        )
        throw new GraphQLError('Frame service is unavailable', {
          extensions: { code: GRAPHQL_ERROR_CODES.SERVICE_UNAVAILABLE },
        })
      }
    }

    logger.error({ method, grpcCode: grpcError?.code }, 'Frame RPC failed')
    throw new GraphQLError('Frame operation failed', {
      extensions: { code: GRAPHQL_ERROR_CODES.INTERNAL_SERVER_ERROR },
    })
  }
}
