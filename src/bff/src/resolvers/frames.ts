import { GraphQLError } from 'graphql'
import { GRAPHQL_ERROR_CODES } from '../consts'
import type { FrameClient } from '../frame-client'
import { callGrpc } from '../grpc-client'
import type { FrameData } from '../generated/frameinventory/v1/FrameData'
import type { Timestamp__Output } from '../generated/google/protobuf/Timestamp'
import type { FrameAttributesInput, Resolvers } from '../generated/graphql'

const MAX_VERSION_ID = 9_223_372_036_854_775_807n

function badInput(message: string) {
  return new GraphQLError(message, {
    extensions: { code: GRAPHQL_ERROR_CODES.BAD_USER_INPUT },
  })
}

function validateFrameId(frameId: string) {
  if (!frameId.trim()) {
    throw badInput('Frame ID must not be blank.')
  }
}

function validateVersionId(versionId: string) {
  if (
    !/^[1-9][0-9]{0,18}$/.test(versionId) ||
    BigInt(versionId) > MAX_VERSION_ID
  ) {
    throw badInput(
      'Expected version ID must be a positive 64-bit integer string.',
    )
  }
}

function toFrameData(input: FrameAttributesInput): FrameData {
  return {
    status: input.status,
    statusReason: input.statusReason ?? undefined,
    siteNo: input.siteNo ?? undefined,
    inventorySiteNo: input.inventorySiteNo ?? undefined,
    panelNumber: input.panelNumber ?? undefined,
    locationId: input.locationId ?? undefined,
    environment: input.environment ?? undefined,
    address: input.address ?? undefined,
    station: input.station ?? undefined,
    airport: input.airport ?? undefined,
    latitude: input.latitude ?? undefined,
    longitude: input.longitude ?? undefined,
    distanceToClosestSchool: input.distanceToClosestSchool ?? undefined,
    location: input.location ?? undefined,
    format: input.format ?? undefined,
    sizeCode: input.sizeCode ?? undefined,
    aspectRatioCode: input.aspectRatioCode ?? undefined,
    tSize: input.tSize ?? undefined,
    pixelHeight: input.pixelHeight ?? undefined,
    pixelWidth: input.pixelWidth ?? undefined,
    illuminationTypeId: input.illuminationTypeId ?? undefined,
    numberOfSlots: input.numberOfSlots ?? undefined,
    impactWeight: input.impactWeight ?? undefined,
    premium: input.premium ?? undefined,
    productionRateCard: input.productionRateCard ?? undefined,
    productionRateCardLegacy: input.productionRateCardLegacy ?? undefined,
    pricingGrade: input.pricingGrade ?? undefined,
  }
}

function formatTimestamp(timestamp: Timestamp__Output) {
  const date = new Date(Number(timestamp.seconds) * 1_000).toISOString()
  const fraction = String(timestamp.nanos).padStart(9, '0')
  return date.replace('.000Z', `.${fraction}Z`)
}

export function createFrameResolvers(client: FrameClient) {
  return {
    Query: {
      frames(_parent, args, { correlationId }) {
        const page = args.page ?? undefined
        const size = args.size ?? undefined
        const statuses = args.statuses ?? undefined
        const search = args.search ?? undefined

        if (page !== undefined && page < 0) {
          throw badInput('Page must be 0 or greater.')
        }

        if (size !== undefined && (size < 1 || size > 50)) {
          throw badInput('Size must be between 1 and 50.')
        }

        if (statuses?.some((status) => status.includes('\0'))) {
          throw badInput('Status codes must not contain null characters.')
        }

        if (search?.includes('\0')) {
          throw badInput('Search must not contain null characters.')
        }

        return callGrpc(
          'ListFrames',
          client.listFrames.bind(client),
          { page, size, statuses, search },
          correlationId,
          true,
        )
      },
      frame(_parent, { frameId }, { correlationId }) {
        validateFrameId(frameId)
        return callGrpc(
          'GetFrame',
          client.getFrame.bind(client),
          { frameId },
          correlationId,
          true,
        )
      },
      async frameHistory(_parent, { frameId }, { correlationId }) {
        validateFrameId(frameId)
        const history = await callGrpc(
          'GetFrameHistory',
          client.getFrameHistory.bind(client),
          { frameId },
          correlationId,
          true,
        )
        return history.versions
      },
    },
    Mutation: {
      createFrame(_parent, { frameId, attributes }, { correlationId }) {
        validateFrameId(frameId)
        if (frameId.length > 128) {
          throw badInput('Frame ID must be 128 characters or fewer.')
        }
        return callGrpc(
          'CreateFrame',
          client.createFrame.bind(client),
          {
            frameId,
            attributes: toFrameData(attributes),
          },
          correlationId,
        )
      },
      updateFrame(
        _parent,
        { frameId, expectedVersionId, attributes },
        { correlationId },
      ) {
        validateFrameId(frameId)
        validateVersionId(expectedVersionId)
        return callGrpc(
          'UpdateFrame',
          client.updateFrame.bind(client),
          {
            frameId,
            expectedVersionId,
            attributes: toFrameData(attributes),
          },
          correlationId,
        )
      },
      async deleteFrame(
        _parent,
        { frameId, expectedVersionId },
        { correlationId },
      ) {
        validateFrameId(frameId)
        if (expectedVersionId != null) {
          validateVersionId(expectedVersionId)
        }
        await callGrpc(
          'DeleteFrame',
          client.deleteFrame.bind(client),
          {
            frameId,
            expectedVersionId: expectedVersionId ?? undefined,
          },
          correlationId,
        )
        return true
      },
    },
    Frame: {
      attributes(frame) {
        if (!frame.attributes) {
          throw new GraphQLError('Frame attributes are unavailable', {
            extensions: { code: GRAPHQL_ERROR_CODES.INTERNAL_SERVER_ERROR },
          })
        }
        return frame.attributes
      },
      validFrom(frame) {
        if (!frame.validFrom) {
          throw new GraphQLError('Frame validity start is unavailable', {
            extensions: { code: GRAPHQL_ERROR_CODES.INTERNAL_SERVER_ERROR },
          })
        }
        return formatTimestamp(frame.validFrom)
      },
      validTo(frame) {
        return frame.validTo && formatTimestamp(frame.validTo)
      },
      externalReferences(frame) {
        return Object.entries(frame.externalReferences).map(([key, value]) => ({
          key,
          value,
        }))
      },
    },
  } satisfies Resolvers
}
