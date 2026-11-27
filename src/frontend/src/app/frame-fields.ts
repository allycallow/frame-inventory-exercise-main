import type { FrameDetailQuery } from '../generated/graphql'
import { label } from './inventory-api'

type Attributes = NonNullable<FrameDetailQuery['frame']>['attributes']
export type FieldValue = string | number | boolean | null | undefined

export const frameFieldGroups = [
  {
    title: 'Frame',
    fields: [
      ['status', 'Status', (a) => a.status],
      ['statusReason', 'Status reason', (a) => a.statusReason],
      ['siteNo', 'Site number', (a) => a.siteNo],
      ['inventorySiteNo', 'Inventory site number', (a) => a.inventorySiteNo],
      ['panelNumber', 'Panel number', (a) => a.panelNumber],
      ['locationId', 'Location ID', (a) => a.locationId],
      ['environment', 'Environment', (a) => a.environment],
    ],
  },
  {
    title: 'Location',
    fields: [
      ['address', 'Address', (a) => a.address],
      ['location.countryCode', 'Country code', (a) => a.location?.countryCode],
      ['location.region', 'Region', (a) => a.location?.region],
      ['location.town', 'Town', (a) => a.location?.town],
      ['location.postcode', 'Postcode', (a) => a.location?.postcode],
      ['station', 'Station', (a) => a.station],
      ['airport', 'Airport', (a) => a.airport],
      ['latitude', 'Latitude', (a) => a.latitude],
      ['longitude', 'Longitude', (a) => a.longitude],
      ['distanceToClosestSchool', 'Distance to closest school', (a) => a.distanceToClosestSchool],
    ],
  },
  {
    title: 'Format and specifications',
    fields: [
      ['format.technology', 'Technology', (a) => a.format?.technology],
      ['format.formatCode', 'Format code', (a) => a.format?.formatCode],
      ['format.sizeGroupCode', 'Size group code', (a) => a.format?.sizeGroupCode],
      ['sizeCode', 'Size code', (a) => a.sizeCode],
      ['aspectRatioCode', 'Aspect ratio code', (a) => a.aspectRatioCode],
      ['tSize', 'T-size', (a) => a.tSize],
      ['pixelHeight', 'Pixel height', (a) => a.pixelHeight],
      ['pixelWidth', 'Pixel width', (a) => a.pixelWidth],
      ['illuminationTypeId', 'Illumination type ID', (a) => a.illuminationTypeId],
      ['numberOfSlots', 'Number of slots', (a) => a.numberOfSlots],
    ],
  },
  {
    title: 'Commercial',
    fields: [
      ['impactWeight', 'Impact weight', (a) => a.impactWeight],
      ['premium', 'Premium', (a) => a.premium],
      ['productionRateCard', 'Production rate card', (a) => a.productionRateCard],
      ['productionRateCardLegacy', 'Legacy production rate card', (a) => a.productionRateCardLegacy],
      ['pricingGrade', 'Pricing grade', (a) => a.pricingGrade],
    ],
  },
] as const satisfies ReadonlyArray<{
  title: string
  fields: ReadonlyArray<readonly [string, string, (attributes: Attributes) => FieldValue]>
}>

export type FrameField = (typeof frameFieldGroups)[number]['fields'][number][0]

export function formatFrameField(field: FrameField, value: FieldValue): string | null {
  if (value == null || value === '') return null
  if (field === 'status') return label(String(value))
  if (field === 'premium') return value ? 'Yes' : 'No'
  if (field === 'distanceToClosestSchool') return `${value} m`
  return String(value)
}
