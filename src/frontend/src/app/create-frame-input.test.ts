import { expect, test } from '@jest/globals'
import { readCreateFrameInput } from './create-frame-input'

function form(values: Record<string, string> = {}): FormData {
  const data = new FormData()
  for (const [name, value] of Object.entries({ frameId: 'FRAME-1', status: 'DRAFT', ...values })) {
    data.set(name, value)
  }
  return data
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
    premium: 'on',
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
  [{ countryCode: 'GBP', region: 'London', town: 'London', postcode: 'SW1A 1AA' }, 'Enter a two-letter country code'],
  [{ technology: 'DIGITAL' }, 'Choose a technology'],
  [{ technology: 'OTHER', formatCode: 'D6', sizeGroupCode: 'SMALL' }, 'Choose a technology'],
  [{ numberOfSlots: '-1' }, 'Enter a whole number of slots'],
  [{ numberOfSlots: '0.5' }, 'Enter a whole number of slots'],
  [{ numberOfSlots: '2147483648' }, 'Enter a whole number of slots'],
  [{ impactWeight: '1.0 kg' }, 'Enter a decimal number for impact weight'],
] satisfies [Record<string, string>, string][])('rejects invalid input %j', (values, message) => {
  expect(readCreateFrameInput(form(values))).toEqual({ error: expect.stringContaining(message) })
})
