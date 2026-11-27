import type { FrameHistoryQuery } from '../generated/graphql'
import { formatFrameField, frameFieldGroups, type FieldValue, type FrameField } from './frame-fields'

type Version = FrameHistoryQuery['frameHistory'][number]

export interface FieldChange {
  field: string
  label: string
  before: string | null
  after: string | null
}

function comparable(field: FrameField, value: FieldValue): Exclude<FieldValue, undefined> {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || (field !== 'latitude' && field !== 'longitude' && field !== 'impactWeight')) {
    return value
  }

  // The API sends plain decimal strings to preserve PostgreSQL numeric precision.
  const [integer, fraction = ''] = value.replace(/^[+-]/, '').split('.')
  const whole = integer.replace(/^0+/, '') || '0'
  const decimals = fraction.replace(/0+$/, '')
  if (whole === '0' && !decimals) return '0'
  const sign = value.startsWith('-') ? '-' : ''
  return decimals ? `${sign}${whole}.${decimals}` : `${sign}${whole}`
}

function matchLinks(ids: readonly string[], otherIds: readonly string[]): { shared: string[]; unmatched: string[] } {
  const counts = new Map<string, number>()
  for (const id of otherIds) counts.set(id, (counts.get(id) ?? 0) + 1)

  const shared: string[] = []
  const unmatched: string[] = []
  for (const id of ids) {
    const count = counts.get(id) ?? 0
    if (count > 0) {
      counts.set(id, count - 1)
      shared.push(id)
    } else {
      unmatched.push(id)
    }
  }
  return { shared, unmatched }
}

export function diffVersions(previous: Version, next: Version): FieldChange[] {
  const changes: FieldChange[] = []
  for (const { fields } of frameFieldGroups) {
    for (const [field, label, read] of fields) {
      const before = read(previous.attributes)
      const after = read(next.attributes)
      if (comparable(field, before) !== comparable(field, after)) {
        changes.push({ field, label, before: formatFrameField(field, before), after: formatFrameField(field, after) })
      }
    }
  }

  const previousRefs = new Map(previous.externalReferences.map(({ key, value }) => [key, value || null]))
  const nextRefs = new Map(next.externalReferences.map(({ key, value }) => [key, value || null]))
  for (const key of new Set([...previousRefs.keys(), ...nextRefs.keys()])) {
    const before = previousRefs.get(key)
    const after = nextRefs.get(key)
    if (before !== after) {
      changes.push({
        field: `externalReferences.${key}`,
        label: before === undefined ? `External reference ${key} (added)`
          : after === undefined ? `External reference ${key} (removed)`
          : `External reference ${key}`,
        before: before ?? null,
        after: after ?? null,
      })
    }
  }

  const { shared: previousOrder, unmatched: removed } = matchLinks(previous.linkedFrameIds, next.linkedFrameIds)
  const { shared: nextOrder, unmatched: added } = matchLinks(next.linkedFrameIds, previous.linkedFrameIds)
  changes.push(
    ...removed.map((id, index) => ({
      field: `linkedFrameIds.removed.${index}`, label: 'Linked frames (removed)', before: id, after: null,
    })),
    ...added.map((id, index) => ({
      field: `linkedFrameIds.added.${index}`, label: 'Linked frames (added)', before: null, after: id,
    })),
  )
  if (previousOrder.some((id, index) => id !== nextOrder[index])) {
    changes.push({
      field: 'linkedFrameIds.order',
      label: 'Linked frames (reordered)',
      before: previousOrder.join(', '),
      after: nextOrder.join(', '),
    })
  }

  return changes
}
