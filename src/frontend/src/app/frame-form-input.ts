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

export type FrameFormValues = {
  frameId: string
  status: string
  statusReason: string
  siteNo: string
  environment: string
  address: string
  countryCode: string
  region: string
  town: string
  postcode: string
  technology: string
  formatCode: string
  sizeGroupCode: string
  numberOfSlots: string
  impactWeight: string
  pricingGrade: string
  productionRateCard: string
  productionRateCardLegacy: string
  premium: boolean
}

export function frameFormValues(frame?: EditableFrame): FrameFormValues {
  const attributes = frame?.attributes
  return {
    frameId: frame?.frameId ?? '',
    status: attributes?.status ?? '',
    statusReason: attributes?.statusReason ?? '',
    siteNo: attributes?.siteNo ?? '',
    environment: attributes?.environment ?? '',
    address: attributes?.address ?? '',
    countryCode: attributes?.location?.countryCode ?? '',
    region: attributes?.location?.region ?? '',
    town: attributes?.location?.town ?? '',
    postcode: attributes?.location?.postcode ?? '',
    technology: attributes?.format?.technology ?? '',
    formatCode: attributes?.format?.formatCode ?? '',
    sizeGroupCode: attributes?.format?.sizeGroupCode ?? '',
    numberOfSlots: String(attributes?.numberOfSlots ?? ''),
    impactWeight: attributes?.impactWeight ?? '',
    pricingGrade: attributes?.pricingGrade ?? '',
    productionRateCard: attributes?.productionRateCard ?? '',
    productionRateCardLegacy: attributes?.productionRateCardLegacy ?? '',
    premium: attributes?.premium ?? false,
  }
}

export function readCreateFrameInput(
  form: FrameFormValues,
): { variables: CreateFrameMutationVariables } | { error: string } {
  const frameId = form.frameId.trim()
  if (!frameId || frameId.length > 128 || /\p{Cc}/u.test(frameId)) {
    return { error: 'Enter a frame ID of up to 128 characters without control characters.' }
  }

  const input = readFrameAttributes(form)
  return 'error' in input ? input : { variables: { frameId, attributes: input.attributes } }
}

export function readUpdateFrameInput(
  form: FrameFormValues,
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
  form: FrameFormValues,
  original?: EditableFrame['attributes'],
): { attributes: FrameAttributesInput } | { error: string } {
  function text(name: Exclude<keyof FrameFormValues, 'premium'>, previous?: string | null): string {
    const value = form[name]
    return value === previous ? value : value.trim()
  }

  function optionalText(
    name: Exclude<keyof FrameFormValues, 'premium'>,
    previous?: string | null,
  ): string | null | undefined {
    if (form[name] === (previous ?? '')) return previous
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
      premium: form.premium,
      pricingGrade: optionalText('pricingGrade', original?.pricingGrade),
      productionRateCard: optionalText('productionRateCard', original?.productionRateCard),
      productionRateCardLegacy: optionalText(
        'productionRateCardLegacy',
        original?.productionRateCardLegacy,
      ),
    },
  }
}
