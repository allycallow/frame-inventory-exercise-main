import { expect, test } from '@jest/globals'
import { frameDetailHref, frameIdFromSegment } from './frame-route'

test('uses the frame ID as a route segment', () => {
  expect(frameDetailHref('FRM-00214')).toBe('/frames/FRM-00214')
})

test.each(['Frame A/%+#', '.', '..', '~.', '~..', '~~example', 'München'])(
  'round-trips the frame ID %s through a browser URL',
  (frameId) => {
    const url = new URL(frameDetailHref(frameId), 'https://inventory.example')
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    const segments = url.pathname.split('/')
    expect(segments).toEqual(['', 'frames', expect.any(String)])
    expect(frameIdFromSegment(segments[2])).toBe(frameId)
  },
)
