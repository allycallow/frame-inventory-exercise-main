import type {
  CreateFrameMutationVariables,
  FrameAttributesInput,
  FrameForEditQuery,
  FrameStatus,
  FrameTechnology,
  UpdateFrameMutationVariables,
} from '../generated/graphql'

export const FRAME_STATUSES = [
  'DRAFT',
  'PENDING',
  'LIVE',
  'MAINTENANCE',
  'BLOCKED',
] as const satisfies readonly FrameStatus[]
export const FRAME_TECHNOLOGIES = [
  'CLASSIC',
  'DIGITAL',
] as const satisfies readonly FrameTechnology[]
export const MAX_SLOTS = 2_147_483_647
export type EditableFrame = NonNullable<FrameForEditQuery['frame']>

export function readCreateFrameInput(
  form: FormData,
): { variables: CreateFrameMutationVariables } | { error: string } {
  function text(name: string): string {
    const value = form.get(name)
    return typeof value === 'string' ? value.trim() : ''
  }

  const frameId = text('frameId')
  if (!frameId || frameId.length > 128 || /\p{Cc}/u.test(frameId)) {
    return { error: 'Enter a frame ID of up to 128 characters without control characters.' }
  }

  const input = readFrameAttributes(form)
  return 'error' in input ? input : { variables: { frameId, attributes: input.attributes } }
}

export function readUpdateFrameInput(
  form: FormData,
  frame: EditableFrame,
): { variables: UpdateFrameMutationVariables } | { error: string } {
  const original = frame.attributes
  const input = readFrameAttributes(form, original)
  if ('error' in input) return input

  // The mutation replaces all attributes, including those the form does not expose.
  return {
    variables: {
      frameId: frame.frameId,
      expectedVersionId: frame.versionId,
      attributes: {
        ...input.attributes,
        inventorySiteNo: original.inventorySiteNo,
        panelNumber: original.panelNumber,
        locationId: original.locationId,
        station: original.station,
        airport: original.airport,
        latitude: original.latitude,
        longitude: original.longitude,
        distanceToClosestSchool: original.distanceToClosestSchool,
        sizeCode: original.sizeCode,
        aspectRatioCode: original.aspectRatioCode,
        tSize: original.tSize,
        pixelHeight: original.pixelHeight,
        pixelWidth: original.pixelWidth,
        illuminationTypeId: original.illuminationTypeId,
      },
    },
  }
}

function readFrameAttributes(
  form: FormData,
  original?: EditableFrame['attributes'],
): { attributes: FrameAttributesInput } | { error: string } {
  function text(name: string, previous?: string | null): string {
    const value = form.get(name)
    return typeof value === 'string' ? (value === previous ? value : value.trim()) : ''
  }

  function optionalText(
    name: keyof FrameAttributesInput,
    previous?: string | null,
  ): string | null | undefined {
    if (form.get(name) === (previous ?? '')) return previous
    return text(name) || undefined
  }

  const statusInput = text('status')
  const status = FRAME_STATUSES.find((value) => value === statusInput)
  if (!status) return { error: 'Choose a frame status.' }

  const countryCode = text('countryCode').toUpperCase()
  const region = text('region', original?.location?.region)
  const town = text('town', original?.location?.town)
  const postcode = text('postcode', original?.location?.postcode)
  const location =
    countryCode || region || town || postcode ? { countryCode, region, town, postcode } : undefined
  if (location && (!/^[A-Z]{2}$/.test(countryCode) || !region || !town || !postcode)) {
    return { error: 'Enter a two-letter country code, region, town and postcode for the location.' }
  }
  if (location && (region.length > 128 || town.length > 128 || postcode.length > 32)) {
    return { error: 'Use up to 128 characters for the region and town and 32 for the postcode.' }
  }

  const technologyInput = text('technology')
  const technology = FRAME_TECHNOLOGIES.find((value) => value === technologyInput)
  const formatCode = text('formatCode', original?.format?.formatCode)
  const sizeGroupCode = text('sizeGroupCode', original?.format?.sizeGroupCode)
  if (
    (technologyInput || formatCode || sizeGroupCode) &&
    (!technology || !formatCode || !sizeGroupCode)
  ) {
    return { error: 'Choose a technology and enter both the format code and size group code.' }
  }
  if (formatCode.length > 128 || sizeGroupCode.length > 128) {
    return { error: 'Use up to 128 characters for the format code and size group code.' }
  }

  const slots = text('numberOfSlots')
  const numberOfSlots = slots ? Number(slots) : undefined
  if (
    numberOfSlots !== undefined &&
    (!Number.isInteger(numberOfSlots) || numberOfSlots < 0 || numberOfSlots > MAX_SLOTS)
  ) {
    return { error: 'Enter a whole number of slots between 0 and 2,147,483,647.' }
  }
  const impactWeight = text('impactWeight')
  if (
    impactWeight &&
    (impactWeight.length > 128 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(impactWeight))
  ) {
    return { error: 'Enter a decimal number of up to 128 characters for impact weight.' }
  }

  return {
    attributes: {
      status,
      statusReason: optionalText('statusReason', original?.statusReason),
      siteNo: optionalText('siteNo', original?.siteNo),
      environment: optionalText('environment', original?.environment),
      address: optionalText('address', original?.address),
      location,
      format: technology ? { technology, formatCode, sizeGroupCode } : undefined,
      numberOfSlots,
      impactWeight: impactWeight || undefined,
      premium: form.has('premium'),
      pricingGrade: optionalText('pricingGrade', original?.pricingGrade),
      productionRateCard: optionalText('productionRateCard', original?.productionRateCard),
      productionRateCardLegacy: optionalText(
        'productionRateCardLegacy',
        original?.productionRateCardLegacy,
      ),
    },
  }
}
