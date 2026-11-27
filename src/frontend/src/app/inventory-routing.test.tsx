/** @jest-environment jsdom */

import { MockedProvider } from '@apollo/client/testing/react'
import { afterEach, expect, jest, test } from '@jest/globals'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImportStatusDocument, RowErrorsDocument, type ImportStatusQuery } from '../generated/graphql'

const push = jest.fn<(path: string) => void>()
const redirect = jest.fn<(path: string) => never>()
let pathname = '/frames'
const jobId = '12345678-1234-1234-1234-123456789abc'
const jobPath = `/imports/${jobId}`

jest.doMock('next/navigation', () => ({
  usePathname: () => pathname,
  useParams: () => ({ jobId }),
  useRouter: () => ({ push }),
  redirect: (path: string): never => redirect(path),
}))
const { default: ImportJobPage } = jest.requireActual<typeof import('./imports/[jobId]/page')>('./imports/[jobId]/page')
const { default: ImportsPage } = jest.requireActual<typeof import('./imports/page')>('./imports/page')
const { ImportUpload } = jest.requireActual<typeof import('./imports/import-upload')>('./imports/import-upload')
const { InventoryWorkspace } = jest.requireActual<typeof import('./inventory-workspace')>('./inventory-workspace')
const { default: Home } = jest.requireActual<typeof import('./page')>('./page')

afterEach(() => {
  cleanup()
  push.mockClear()
})

test.each([
  ['/frames', 'Frames'],
  ['/frames/FRAME-1', 'Frames'],
  ['/imports', 'Imports'],
  [jobPath, 'Imports'],
])('highlights the section for %s', (path, section) => {
  pathname = path
  render(<InventoryWorkspace><h1>Page content</h1></InventoryWorkspace>)

  expect(screen.getByRole('link', { name: section, current: 'page' })).toBeDefined()
  expect(screen.getByRole('link', { name: 'Frames' }).getAttribute('href')).toBe('/frames')
  expect(screen.getByRole('link', { name: 'Imports' }).getAttribute('href')).toBe('/imports')
  expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1)
})

test('redirects the root route to the frames list', () => {
  Home()

  expect(redirect).toHaveBeenCalledWith('/frames')
})

test('opens a looked-up job at its own URL', async () => {
  pathname = '/imports'
  render(<InventoryWorkspace><ImportsPage /></InventoryWorkspace>)

  fireEvent.change(screen.getByRole('textbox', { name: 'Job ID' }), {
    target: { value: ` ${jobId.toUpperCase()} ` },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))

  await waitFor(() => expect(push).toHaveBeenCalledWith(jobPath))
})

test('opens a bookmarked job and its row errors after the operator enters a token', async () => {
  pathname = jobPath
  const token = 'a'.repeat(64)
  const job: ImportStatusQuery['importJob'] = {
    __typename: 'ImportJob',
    jobId,
    status: 'COMPLETED_WITH_ERRORS',
    forceOverwrite: false,
    uploadExpiresAt: '2026-11-27T13:00:00Z',
    finishedAt: '2026-11-27T12:15:00Z',
    rowsRead: 5,
    rowsApplied: 4,
    rowsUnchanged: 0,
    rowsRejected: 1,
    failureCode: null,
  }
  const result = jest.fn(() => ({ data: { importJob: job } }))
  const page = await ImportJobPage({ params: Promise.resolve({ jobId }) })

  render(
    <MockedProvider mocks={[
      { request: { query: ImportStatusDocument, variables: { id: jobId } }, result },
      {
        request: { query: RowErrorsDocument, variables: { id: jobId, page: 0 } },
        result: { data: { importRowErrors: {
          __typename: 'ImportRowErrorPage', page: 0, hasNext: false,
          items: [{
            __typename: 'ImportRowError', rowNumber: 2, code: 'INVALID_FIELD',
            frameId: 'FRAME-1', detail: 'Unknown status',
          }],
        } } },
      },
    ]}>
      <InventoryWorkspace>
        <ImportUpload />
        {page}
      </InventoryWorkspace>
    </MockedProvider>,
  )

  expect(screen.getByText('Enter your local operator token to view this job.')).toBeDefined()
  expect(result).toHaveBeenCalledTimes(0)
  fireEvent.change(screen.getByLabelText('Local operator token'), { target: { value: token } })

  expect(await screen.findByText('Completed with errors')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'View row errors' }))
  expect(await screen.findByText('Unknown status')).toBeDefined()
  expect(push).toHaveBeenCalledTimes(0)

  fireEvent.change(screen.getByLabelText('Local operator token'), { target: { value: '' } })
  expect(screen.queryByText('Unknown status')).toBeNull()
})
