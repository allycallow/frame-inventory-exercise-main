/** @jest-environment jsdom */

import type { MockLink } from '@apollo/client/testing'
import { MockedProvider } from '@apollo/client/testing/react'
import { afterEach, expect, jest, test } from '@jest/globals'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { GraphQLError } from 'graphql'
import {
  FrameDetailDocument,
  FrameForEditDocument,
  FrameHistoryDocument,
  type FrameHistoryQuery,
  UpdateFrameDocument,
  type FrameDetailQuery,
  type UpdateFrameMutationVariables,
} from '../generated/graphql'

jest.doMock('./inventory-workspace', () => ({ useInventoryActions: () => ({ showImports: () => undefined }) }))
const { FrameDetail } = jest.requireActual<typeof import('./frame-detail')>('./frame-detail')

// jsdom implements the open attribute but lacks the native dialog methods.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { value(this: HTMLDialogElement): void { this.open = true } },
  close: { value(this: HTMLDialogElement): void { this.open = false } },
})

afterEach(cleanup)

const frameId = 'FRAME-1'
const attributes: NonNullable<FrameDetailQuery['frame']>['attributes'] = {
  __typename: 'FrameAttributes',
  status: 'LIVE',
  premium: false,
  address: 'Original address',
  statusReason: null,
  siteNo: null,
  inventorySiteNo: null,
  panelNumber: null,
  locationId: null,
  environment: null,
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
  productionRateCard: null,
  productionRateCardLegacy: null,
  pricingGrade: null,
}

function detailResponse(address: string): MockLink.MockedResponse {
  return {
    request: { query: FrameDetailDocument, variables: { id: frameId } },
    result: { data: { frame: {
      __typename: 'Frame', frameId, current: true, attributes: { ...attributes, address },
      linkedFrameIds: [], externalReferences: [],
    } } },
  }
}

function editResponse(versionId: string, address: string): MockLink.MockedResponse {
  return {
    request: { query: FrameForEditDocument, variables: { frameId } },
    result: { data: { frame: {
      __typename: 'Frame', frameId, versionId, current: true, attributes: { ...attributes, address },
    } } },
  }
}

function updateRequest(versionId: string, address: string): MockLink.MockedRequest<UpdateFrameMutationVariables> {
  return {
    query: UpdateFrameDocument,
    variables: (variables: UpdateFrameMutationVariables): boolean => (
      variables.frameId === frameId &&
      variables.expectedVersionId === versionId &&
      variables.attributes.address === address
    ),
  }
}

test('opens the prefilled edit dialog from details and refreshes after saving a reloaded version', async () => {
  render(
    <MockedProvider mocks={[
      detailResponse('Original address'),
      editResponse('1', 'Original address'),
      {
        request: updateRequest('1', 'Unsaved address'),
        result: { errors: [new GraphQLError('Version conflict', { extensions: { code: 'CONFLICT' } })] },
      },
      editResponse('2', 'Latest address'),
      {
        request: updateRequest('2', 'Updated address'),
        result: { data: { updateFrame: { __typename: 'Frame', frameId } } },
      },
      detailResponse('Updated address'),
    ]}>
      <FrameDetail frameId={frameId} />
    </MockedProvider>,
  )

  const edit = await screen.findByRole('button', { name: 'Edit' })
  expect(screen.getByRole('button', { name: 'Version history' })).toBeDefined()
  fireEvent.click(edit)
  const dialog = within(screen.getByRole('dialog', { name: 'Edit frame' }))
  const address = await dialog.findByRole<HTMLInputElement>('textbox', { name: 'Address' })
  expect(address.value).toBe('Original address')
  expect(dialog.getByRole<HTMLInputElement>('textbox', { name: 'Frame ID' }).readOnly).toBe(true)

  fireEvent.change(address, { target: { value: 'Unsaved address' } })
  const save = dialog.getByRole<HTMLButtonElement>('button', { name: 'Save changes' })
  fireEvent.click(save)
  expect((await dialog.findByRole('alert')).textContent).toContain('changed while you were editing')
  expect(save.disabled).toBe(true)

  fireEvent.click(dialog.getByRole('button', { name: 'Reload latest version' }))
  await waitFor(() => expect(address.value).toBe('Latest address'))
  fireEvent.change(address, { target: { value: 'Updated address' } })
  fireEvent.click(save)

  expect(await screen.findByText('Updated address')).toBeDefined()
  expect(screen.getByRole('status').textContent).toBe(`Frame ${frameId} was updated.`)
  expect(screen.queryByRole('dialog')).toBeNull()
})

const missingFrame = new GraphQLError('Frame not found', { extensions: { code: 'NOT_FOUND' } })

test('opens the history of a soft-deleted frame without offering Edit', async () => {
  const history: FrameHistoryQuery = {
    frameHistory: [{
      __typename: 'Frame', versionId: '1', attributes, linkedFrameIds: [], externalReferences: [],
      validFrom: '2026-10-01T12:00:00Z', validTo: '2026-10-02T12:00:00Z', current: false,
      changeSource: 'MANUAL_CREATE', closedByChangeSource: 'MANUAL_DELETE',
      importJobId: null, sourceModifiedAt: null,
    }],
  }

  render(
    <MockedProvider mocks={[
      {
        request: { query: FrameDetailDocument, variables: { id: frameId } },
        result: { errors: [missingFrame] },
      },
      {
        request: { query: FrameHistoryDocument, variables: { id: frameId } },
        result: { data: history },
        maxUsageCount: 2,
      },
    ]}>
      <FrameDetail frameId={frameId} />
    </MockedProvider>,
  )

  expect(await screen.findByText('This frame was deleted.')).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Version history' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Version history' }))
  expect(await dialog.findByText('Deleted')).toBeDefined()
  expect(dialog.getByText('Manual create')).toBeDefined()
})

test('shows a missing frame without offering Edit or Version history', async () => {
  render(
    <MockedProvider mocks={[
      {
        request: { query: FrameDetailDocument, variables: { id: frameId } },
        result: { errors: [missingFrame] },
      },
      {
        request: { query: FrameHistoryDocument, variables: { id: frameId } },
        result: { errors: [missingFrame] },
      },
    ]}>
      <FrameDetail frameId={frameId} />
    </MockedProvider>,
  )

  expect(await screen.findByText('Frame not found.')).toBeDefined()
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Version history' })).toBeNull()
})
