import type { CreateFrameMutationVariables, FrameStatus, FrameTechnology } from '../generated/graphql'

export const FRAME_STATUSES = [
  'DRAFT', 'PENDING', 'LIVE', 'MAINTENANCE', 'BLOCKED',
] as const satisfies readonly FrameStatus[]
export const FRAME_TECHNOLOGIES = [
  'CLASSIC', 'DIGITAL',
] as const satisfies readonly FrameTechnology[]
export const MAX_SLOTS = 2_147_483_647

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
  const statusInput = text('status')
  const status = FRAME_STATUSES.find((value) => value === statusInput)
  if (!status) return { error: 'Choose a frame status.' }

  const countryCode = text('countryCode').toUpperCase()
  const region = text('region')
  const town = text('town')
  const postcode = text('postcode')
  const location = countryCode || region || town || postcode
    ? { countryCode, region, town, postcode }
    : undefined
  if (location && (!/^[A-Z]{2}$/.test(countryCode) || !region || !town || !postcode)) {
    return { error: 'Enter a two-letter country code, region, town and postcode for the location.' }
  }
  if (location && (region.length > 128 || town.length > 128 || postcode.length > 32)) {
    return { error: 'Use up to 128 characters for the region and town and 32 for the postcode.' }
  }

  const technologyInput = text('technology')
  const technology = FRAME_TECHNOLOGIES.find((value) => value === technologyInput)
  const formatCode = text('formatCode')
  const sizeGroupCode = text('sizeGroupCode')
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
  if (numberOfSlots !== undefined && (
    !Number.isInteger(numberOfSlots) || numberOfSlots < 0 || numberOfSlots > MAX_SLOTS
  )) {
    return { error: 'Enter a whole number of slots between 0 and 2,147,483,647.' }
  }
  const impactWeight = text('impactWeight')
  if (impactWeight && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(impactWeight)) {
    return { error: 'Enter a decimal number for impact weight.' }
  }

  return {
    variables: {
      frameId,
      attributes: {
        status,
        statusReason: text('statusReason') || undefined,
        siteNo: text('siteNo') || undefined,
        environment: text('environment') || undefined,
        address: text('address') || undefined,
        location,
        format: technology ? { technology, formatCode, sizeGroupCode } : undefined,
        numberOfSlots,
        impactWeight: impactWeight || undefined,
        premium: form.has('premium'),
        pricingGrade: text('pricingGrade') || undefined,
        productionRateCard: text('productionRateCard') || undefined,
        productionRateCardLegacy: text('productionRateCardLegacy') || undefined,
      },
    },
  }
}
