import { MockedProvider } from '@apollo/client/testing/react'
import { expect, test } from '@jest/globals'
import { renderToStaticMarkup } from 'react-dom/server'
import { InventoryList } from './inventory-list'

test('offers the status filters in lifecycle order after All statuses', () => {
  const markup = renderToStaticMarkup(
    <MockedProvider>
      <InventoryList onEdit={() => undefined} />
    </MockedProvider>,
  )
  const options = Array.from(markup.matchAll(/<option value="([^"]*)"/g), (option) => option[1])

  expect(options).toEqual(['', 'DRAFT', 'PENDING', 'LIVE', 'MAINTENANCE', 'BLOCKED'])
})
