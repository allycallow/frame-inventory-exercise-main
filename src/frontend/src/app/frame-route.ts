export function frameDetailHref(frameId: string): string {
  // Browsers normalize dot segments, even when the dots are percent-encoded.
  const segment = frameId === '.' || frameId === '..' || frameId.startsWith('~')
    ? `~${frameId}`
    : frameId
  return `/frames/${encodeURIComponent(segment)}`
}

export function frameIdFromSegment(segment: string): string {
  const value = decodeURIComponent(segment)
  return value === '~.' || value === '~..' || value.startsWith('~~')
    ? value.slice(1)
    : value
}
