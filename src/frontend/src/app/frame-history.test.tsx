/** @jest-environment jsdom */

import { MockedProvider } from '@apollo/client/testing/react'
import { afterEach, expect, jest, test } from '@jest/globals'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { FrameHistoryDocument, type FrameHistoryQuery } from '../generated/graphql'
import { diffVersions } from './frame-history-diff'
import { HistoryDialog } from './frame-history'
import { dateTime } from './inventory-api'

type Version = FrameHistoryQuery['frameHistory'][number]
type Attributes = Version['attributes']

Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { value(this: HTMLDialogElement): void { this.open = true } },
  close: { value(this: HTMLDialogElement): void { this.open = false } },
})

afterEach(cleanup)

const location = {
  __typename: 'FrameLocation',
  countryCode: 'GB',
  region: 'London',
  town: 'Camden',
  postcode: 'NW1',
} satisfies NonNullable<Attributes['location']>

const format = {
  __typename: 'FrameFormat',
  technology: 'DIGITAL',
  formatCode: 'D6',
  sizeGroupCode: '6S',
} satisfies NonNullable<Attributes['format']>

function version(attributes: Partial<Attributes> = {}, metadata: Partial<Version> = {}): Version {
  return {
    __typename: 'Frame',
    versionId: '1',
    validFrom: '2026-10-01T12:00:00Z',
    validTo: null,
    current: true,
    changeSource: 'MANUAL_CREATE',
    closedByChangeSource: null,
    importJobId: null,
    sourceModifiedAt: null,
    externalReferences: [],
    linkedFrameIds: [],
    ...metadata,
    attributes: {
      __typename: 'FrameAttributes',
      status: 'LIVE',
      statusReason: null,
      siteNo: null,
      inventorySiteNo: null,
      panelNumber: null,
      locationId: null,
      environment: null,
      address: null,
      station: null,
      airport: null,
      latitude: null,
      longitude: null,
      distanceToClosestSchool: null,
      location: null,
      format: null,
      sizeCode: null,
      aspectRatioCode: null,
      tSize: null,
      pixelHeight: null,
      pixelWidth: null,
      illuminationTypeId: null,
      numberOfSlots: null,
      impactWeight: null,
      premium: false,
      productionRateCard: null,
      productionRateCardLegacy: null,
      pricingGrade: null,
      ...attributes,
    },
  }
}

test('ignores identical values, metadata, decimal formatting and equivalent empty values', () => {
  const previous = version({ latitude: '51.50', longitude: '-0.00', impactWeight: '001.2300', siteNo: '' })
  const next = version({
    latitude: '51.5',
    longitude: '+0',
    impactWeight: '1.23',
    siteNo: null,
    location: { ...location, countryCode: '', region: '', town: '', postcode: '' },
    format: { ...format, technology: '', formatCode: '', sizeGroupCode: '' },
  }, {
    versionId: '2', validFrom: '2026-10-02T12:00:00Z', validTo: '2026-10-03T12:00:00Z',
    current: false, changeSource: 'FORCED_OVERWRITE', sourceModifiedAt: '2026-09-01T12:00:00Z',
    importJobId: 'JOB-1', closedByChangeSource: 'MANUAL_DELETE',
  })

  expect(diffVersions(previous, previous)).toEqual([])
  expect(diffVersions(previous, next)).toEqual([])
})

test('formats changed status and premium, and preserves precise decimal changes', () => {
  const previous = version({ status: 'PENDING', impactWeight: '12345678901234567890.10' })
  const next = version({ status: 'LIVE', impactWeight: '12345678901234567890.11', premium: true })
  expect(diffVersions(previous, next)).toEqual([
    { field: 'status', label: 'Status', before: 'Pending', after: 'Live' },
    { field: 'impactWeight', label: 'Impact weight', before: '12345678901234567890.10', after: '12345678901234567890.11' },
    { field: 'premium', label: 'Premium', before: 'No', after: 'Yes' },
  ])
})

test('reports individual location and format changes in detail-page order', () => {
  expect(diffVersions(
    version({ location, format }),
    version({
      location: { ...location, countryCode: 'FR', region: 'Île-de-France', town: 'Paris', postcode: '75001' },
      format: { ...format, technology: 'CLASSIC', formatCode: 'C48', sizeGroupCode: '48S' },
    }),
  )).toEqual([
    { field: 'location.countryCode', label: 'Country code', before: 'GB', after: 'FR' },
    { field: 'location.region', label: 'Region', before: 'London', after: 'Île-de-France' },
    { field: 'location.town', label: 'Town', before: 'Camden', after: 'Paris' },
    { field: 'location.postcode', label: 'Postcode', before: 'NW1', after: '75001' },
    { field: 'format.technology', label: 'Technology', before: 'DIGITAL', after: 'CLASSIC' },
    { field: 'format.formatCode', label: 'Format code', before: 'D6', after: 'C48' },
    { field: 'format.sizeGroupCode', label: 'Size group code', before: '6S', after: '48S' },
  ])
})

function reference(key: string, value: string): Version['externalReferences'][number] {
  return { __typename: 'FrameReference', key, value }
}

test('reports added, removed and changed external references regardless of key order', () => {
  const previous = version({}, {
    externalReferences: [reference('legacy_id', 'old'), reference('retired_id', 'gone'), reference('stable_id', 'kept')],
  })
  const next = version({}, {
    externalReferences: [reference('stable_id', 'kept'), reference('partner_id', 'new'), reference('legacy_id', 'updated')],
  })

  expect(diffVersions(previous, next)).toEqual([
    { field: 'externalReferences.legacy_id', label: 'External reference legacy_id', before: 'old', after: 'updated' },
    { field: 'externalReferences.retired_id', label: 'External reference retired_id (removed)', before: 'gone', after: null },
    { field: 'externalReferences.partner_id', label: 'External reference partner_id (added)', before: null, after: 'new' },
  ])
})

test('reports link additions and removals by occurrence and a reorder as one change', () => {
  const previous = version({}, { linkedFrameIds: ['A', 'A', 'B'] })
  const next = version({}, { linkedFrameIds: ['A', 'C', 'B'] })
  expect(diffVersions(previous, next)).toEqual([
    { field: 'linkedFrameIds.removed.0', label: 'Linked frames (removed)', before: 'A', after: null },
    { field: 'linkedFrameIds.added.0', label: 'Linked frames (added)', before: null, after: 'C' },
  ])
  expect(diffVersions(next, version({}, { linkedFrameIds: ['B', 'A', 'C'] }))).toEqual([
    { field: 'linkedFrameIds.order', label: 'Linked frames (reordered)', before: 'A, C, B', after: 'B, A, C' },
  ])
})

test('renders the timeline, explains changes and toggles additional fields', async () => {
  const jobId = '12345678-1234-1234-1234-123456789abc'
  const created = version({ location, format, status: 'PENDING' }, {
    changeSource: 'CSV_IMPORT', importJobId: jobId, current: false, validTo: '2026-10-02T12:00:00Z',
  })
  const edit = version({
    ...created.attributes, status: 'LIVE', statusReason: 'Approved', siteNo: '1',
    inventorySiteNo: '2', panelNumber: '3', locationId: '4', environment: 'Outdoor',
  }, {
    versionId: '2', validFrom: created.validTo ?? created.validFrom, validTo: '2026-10-03T12:00:00Z',
    changeSource: 'MANUAL_EDIT', current: false,
  })
  const overwritten = version(edit.attributes, {
    versionId: '3', validFrom: edit.validTo ?? edit.validFrom, validTo: '2026-10-04T12:00:00Z',
    changeSource: 'FORCED_OVERWRITE', importJobId: 'JOB-2', closedByChangeSource: 'MANUAL_DELETE', current: false,
  })

  render(
    <MockedProvider mocks={[{
      request: { query: FrameHistoryDocument, variables: { id: 'FRAME-1' } },
      result: { data: { frameHistory: [overwritten, edit, created] } },
    }]}>
      <HistoryDialog frameId="FRAME-1" onClose={jest.fn()} />
    </MockedProvider>,
  )

  const dialog = within(screen.getByRole('dialog', { name: 'Version history' }))
  await dialog.findByText('Deleted')
  const [deletion, unchanged, edited, initial] = dialog.getAllByRole('listitem').map((item) => within(item))
  expect(deletion.getByText('Deleted')).toBeDefined()
  expect(deletion.getByText(dateTime('2026-10-04T12:00:00Z'))).toBeDefined()
  expect(unchanged.getByText('No attribute changes')).toBeDefined()
  expect(unchanged.getByText('Forced overwrite')).toBeDefined()
  expect(edited.getByText('Manual edit')).toBeDefined()
  expect(edited.getByText('Version 2')).toBeDefined()
  expect(edited.getByText('Status').nextElementSibling?.textContent).toBe('Changed from Pending →  to Live')
  expect(edited.getByText('Status reason').nextElementSibling?.textContent).toContain('— →')
  expect(edited.queryByText('Location ID')).toBeNull()

  const toggle = edited.getByRole('button', { name: 'Show 2 more' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(edited.getByText('Environment')).toBeDefined()
  fireEvent.click(edited.getByRole('button', { name: 'Show fewer' }))
  expect(edited.queryByText('Environment')).toBeNull()

  expect(initial.getByText('Created')).toBeDefined()
  expect(initial.getByText('Pending')).toBeDefined()
  expect(initial.getByText('Location: Camden, London, NW1, GB')).toBeDefined()
  expect(initial.getByText('Format: DIGITAL, D6, 6S')).toBeDefined()
  expect(initial.getByText('Csv import')).toBeDefined()
  expect(initial.getByRole('link', { name: `Import job ${jobId}` }).getAttribute('href')).toBe(`/imports/${jobId}`)
})
