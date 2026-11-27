import { CombinedGraphQLErrors } from '@apollo/client/errors'

export function errorMessage(error: unknown): string {
  if (CombinedGraphQLErrors.is(error)) return error.errors[0]?.message ?? error.message
  return error instanceof Error ? error.message : 'Something went wrong. Try again.'
}

export function label(value: string): string {
  const text = value.toLowerCase().replaceAll('_', ' ')
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

export function dateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
