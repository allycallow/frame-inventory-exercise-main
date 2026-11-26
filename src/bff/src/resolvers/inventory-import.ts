import { GraphQLError } from 'graphql'
import { GRAPHQL_ERROR_CODES } from '../consts'
import type { ImportJob__Output } from '../generated/frameinventory/v1/ImportJob'
import type { Timestamp__Output } from '../generated/google/protobuf/Timestamp'
import type {
  ImportJob,
  ImportJobStatus,
  ImportMode,
  Resolvers,
} from '../generated/graphql'
import { callGrpc } from '../grpc-client'
import type { InventoryImportClient } from '../inventory-import-client'

const TOKEN = /^Bearer [a-f0-9]{64}$/
const JOB_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

function requireAuthorization(authorization?: string) {
  if (!authorization || !TOKEN.test(authorization)) {
    throw new GraphQLError('An import operator credential is required', {
      extensions: { code: GRAPHQL_ERROR_CODES.UNAUTHENTICATED },
    })
  }
  return authorization
}

function requireJobId(jobId: string) {
  if (!JOB_ID.test(jobId)) {
    throw new GraphQLError('Job ID must be a UUID', {
      extensions: { code: GRAPHQL_ERROR_CODES.BAD_USER_INPUT },
    })
  }
  return jobId
}

function timestamp(value: Timestamp__Output) {
  const date = new Date(Number(value.seconds) * 1000).toISOString()
  const fraction = String(value.nanos).padStart(9, '0')
  return date.replace('.000Z', `.${fraction}Z`)
}

function toJob(job: ImportJob__Output): ImportJob {
  if (
    !job.createdAt ||
    !job.uploadExpiresAt ||
    job.mode === 'IMPORT_MODE_UNSPECIFIED' ||
    job.status === 'IMPORT_JOB_STATUS_UNSPECIFIED'
  ) {
    throw new GraphQLError('Import service returned an incomplete job', {
      extensions: { code: GRAPHQL_ERROR_CODES.INTERNAL_SERVER_ERROR },
    })
  }
  return {
    ...job,
    mode: job.mode as ImportMode,
    status: job.status as ImportJobStatus,
    createdAt: timestamp(job.createdAt),
    uploadExpiresAt: timestamp(job.uploadExpiresAt),
    finishedAt: job.finishedAt ? timestamp(job.finishedAt) : null,
  }
}

export function createImportResolvers(
  configuredClient?: InventoryImportClient,
): Resolvers {
  function client() {
    if (!configuredClient) {
      throw new GraphQLError('Local imports are disabled', {
        extensions: { code: GRAPHQL_ERROR_CODES.SERVICE_UNAVAILABLE },
      })
    }
    return configuredClient
  }

  return {
    Query: {
      async importJob(_parent, { jobId }, context) {
        const imports = client()
        const authorization = requireAuthorization(context.importAuthorization)
        const job = await callGrpc(
          'GetImportJob',
          imports.getImportJob.bind(imports),
          { jobId: requireJobId(jobId) },
          context.correlationId,
          true,
          authorization,
        )
        return toJob(job)
      },
      async importRowErrors(_parent, { jobId, page, size }, context) {
        const imports = client()
        const authorization = requireAuthorization(context.importAuthorization)
        if (
          (page != null && page < 0) ||
          (size != null && (size < 1 || size > 50))
        ) {
          throw new GraphQLError(
            'Page must be nonnegative and size must be 1–50',
            {
              extensions: { code: GRAPHQL_ERROR_CODES.BAD_USER_INPUT },
            },
          )
        }
        return callGrpc(
          'ListImportRowErrors',
          imports.listImportRowErrors.bind(imports),
          {
            jobId: requireJobId(jobId),
            page: page ?? undefined,
            size: size ?? undefined,
          },
          context.correlationId,
          true,
          authorization,
        )
      },
    },
    Mutation: {
      async createImportJob(_parent, { mode, forceOverwrite }, context) {
        const imports = client()
        const authorization = requireAuthorization(context.importAuthorization)
        const result = await callGrpc(
          'CreateImportJob',
          imports.createImportJob.bind(imports),
          {
            mode: mode ?? undefined,
            forceOverwrite: forceOverwrite ?? undefined,
          },
          context.correlationId,
          false,
          authorization,
        )
        if (!result.job) {
          throw new GraphQLError('Import service returned no job', {
            extensions: { code: GRAPHQL_ERROR_CODES.INTERNAL_SERVER_ERROR },
          })
        }
        return {
          job: toJob(result.job),
          uploadUrl: result.uploadUrl,
          uploadHeaders: Object.entries(result.uploadHeaders).map(
            ([name, value]) => ({ name, value }),
          ),
        }
      },
    },
  }
}
