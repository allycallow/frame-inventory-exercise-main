import { expect, test } from '@jest/globals'
import {
  frameFormValues,
  readCreateFrameInput,
  readUpdateFrameInput,
  type EditableFrame,
  type FrameFormValues,
} from './frame-form-input'

function form(values: Partial<FrameFormValues> = {}): FrameFormValues {
  return { ...frameFormValues(), frameId: 'FRAME-1', status: 'DRAFT', ...values }
}

test('accepts a frame ID and status without location, format or commercial details', () => {
  expect(readCreateFrameInput(form())).toEqual({
    variables: { frameId: 'FRAME-1', attributes: { status: 'DRAFT', premium: false } },
  })
})

test('normalizes text without losing a zero slot count or rounding the impact weight', () => {
  const input = form({
    frameId: ' FRAME-1 ',
    status: 'LIVE',
    countryCode: 'gb',
    region: ' London ',
    town: ' London ',
    postcode: ' SW1A 1AA ',
    technology: 'DIGITAL',
    formatCode: ' D6 ',
    sizeGroupCode: ' SMALL ',
    numberOfSlots: '0',
    impactWeight: ' 1.24000000000000001 ',
    premium: true,
    pricingGrade: ' A ',
    productionRateCard: ' Standard ',
    productionRateCardLegacy: ' Legacy ',
  })

  expect(readCreateFrameInput(input)).toEqual({
    variables: {
      frameId: 'FRAME-1',
      attributes: {
        status: 'LIVE',
        location: { countryCode: 'GB', region: 'London', town: 'London', postcode: 'SW1A 1AA' },
        format: { technology: 'DIGITAL', formatCode: 'D6', sizeGroupCode: 'SMALL' },
        numberOfSlots: 0,
        impactWeight: '1.24000000000000001',
        premium: true,
        pricingGrade: 'A',
        productionRateCard: 'Standard',
        productionRateCardLegacy: 'Legacy',
      },
    },
  })
})

test.each([
  [{ frameId: '  ' }, 'Enter a frame ID'],
  [{ frameId: 'X'.repeat(129) }, 'Enter a frame ID'],
  [{ frameId: 'FRAME\t1' }, 'Enter a frame ID'],
  [{ status: 'INVALID' }, 'Choose a frame status'],
  [{ town: 'London' }, 'Enter a two-letter country code'],
  [
    { countryCode: 'GBP', region: 'London', town: 'London', postcode: 'SW1A 1AA' },
    'Enter a two-letter country code',
  ],
  [{ technology: 'DIGITAL' }, 'Choose a technology'],
  [{ technology: 'OTHER', formatCode: 'D6', sizeGroupCode: 'SMALL' }, 'Choose a technology'],
  [{ numberOfSlots: '-1' }, 'Enter a whole number of slots'],
  [{ numberOfSlots: '0.5' }, 'Enter a whole number of slots'],
  [{ numberOfSlots: '2147483648' }, 'Enter a whole number of slots'],
  [{ impactWeight: '1.0 kg' }, 'Enter a decimal number'],
  [{ impactWeight: '1e3' }, 'Enter a decimal number'],
  [{ impactWeight: '1'.repeat(129) }, 'Enter a decimal number'],
] satisfies [Partial<FrameFormValues>, string][])('rejects invalid input %j', (values, message) => {
  expect(readCreateFrameInput(form(values))).toEqual({ error: expect.stringContaining(message) })
})

const currentFrame: EditableFrame = {
  __typename: 'Frame',
  frameId: 'FRAME-1',
  versionId: '9223372036854775806',
  current: true,
  attributes: {
    __typename: 'FrameAttributes',
    status: 'LIVE',
    statusReason: null,
    siteNo: ' 001 ',
    inventorySiteNo: 'INV-1',
    panelNumber: 'Panel A',
    locationId: 'LOC-1',
    environment: 'Outdoor',
    address: 'Old road',
    station: null,
    airport: null,
    latitude: '51.500123456789',
    longitude: '-0.1246',
    distanceToClosestSchool: 0,
    location: {
      __typename: 'FrameLocation',
      countryCode: 'GB',
      region: 'London',
      town: 'London',
      postcode: 'ABC',
    },
    format: {
      __typename: 'FrameFormat',
      technology: 'DIGITAL',
      formatCode: 'D6',
      sizeGroupCode: 'Small',
    },
    sizeCode: '6',
    aspectRatioCode: '16:9',
    tSize: null,
    pixelHeight: 1080,
    pixelWidth: 1920,
    illuminationTypeId: 0,
    numberOfSlots: 0,
    impactWeight: '2.40000000000000001',
    premium: true,
    pricingGrade: 'A',
    productionRateCard: 'Standard',
    productionRateCardLegacy: null,
  },
}

test('sends the loaded version ID and retains attributes outside the form', () => {
  const input = form({
    frameId: 'DO-NOT-USE',
    status: 'BLOCKED',
    statusReason: ' Maintenance requested ',
    siteNo: ' 001 ',
    environment: 'Outdoor',
    address: '',
    countryCode: 'GB',
    region: 'London',
    town: 'Westminster',
    postcode: 'ABC',
    technology: 'DIGITAL',
    formatCode: 'D6',
    sizeGroupCode: 'Small',
    numberOfSlots: '0',
    impactWeight: '2.40000000000000001',
    pricingGrade: 'A',
    productionRateCard: 'Standard',
    productionRateCardLegacy: '',
  })

  expect(readUpdateFrameInput(input, currentFrame)).toEqual({
    variables: {
      frameId: 'FRAME-1',
      expectedVersionId: '9223372036854775806',
      attributes: {
        status: 'BLOCKED',
        statusReason: 'Maintenance requested',
        siteNo: ' 001 ',
        inventorySiteNo: 'INV-1',
        panelNumber: 'Panel A',
        locationId: 'LOC-1',
        environment: 'Outdoor',
        address: undefined,
        station: null,
        airport: null,
        latitude: '51.500123456789',
        longitude: '-0.1246',
        distanceToClosestSchool: 0,
        location: { countryCode: 'GB', region: 'London', town: 'Westminster', postcode: 'ABC' },
        format: { technology: 'DIGITAL', formatCode: 'D6', sizeGroupCode: 'Small' },
        sizeCode: '6',
        aspectRatioCode: '16:9',
        tSize: null,
        pixelHeight: 1080,
        pixelWidth: 1920,
        illuminationTypeId: 0,
        numberOfSlots: 0,
        impactWeight: '2.40000000000000001',
        premium: false,
        pricingGrade: 'A',
        productionRateCard: 'Standard',
        productionRateCardLegacy: null,
      },
    },
  })
})

test('validates partial location and format edits before updating', () => {
  expect(readUpdateFrameInput(form({ countryCode: 'GB' }), currentFrame)).toEqual({
    error: expect.stringContaining('Enter a two-letter country code'),
  })
  expect(readUpdateFrameInput(form({ formatCode: 'D6' }), currentFrame)).toEqual({
    error: expect.stringContaining('Choose a technology'),
  })
})

test('loaded edit values preserve zero slots, decimal precision and the premium checkbox', () => {
  const values = frameFormValues(currentFrame)
  expect(values).toMatchObject({
    frameId: 'FRAME-1',
    numberOfSlots: '0',
    impactWeight: '2.40000000000000001',
    premium: true,
  })
  expect(readUpdateFrameInput(values, currentFrame)).toMatchObject({
    variables: {
      expectedVersionId: currentFrame.versionId,
      attributes: { numberOfSlots: 0, impactWeight: '2.40000000000000001', premium: true },
    },
  })
})
