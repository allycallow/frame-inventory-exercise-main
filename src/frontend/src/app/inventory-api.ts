interface GraphQLResponse<T> {
  data?: T
  errors?: { message: string }[]
}

export async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  const response = await fetch('/api/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
    signal: options.signal,
  })
  const result = (await response.json()) as GraphQLResponse<T>
  if (result.errors?.length) throw new Error(result.errors[0].message)
  if (!response.ok || !result.data) throw new Error('Inventory service returned no result.')
  return result.data
}

export function errorMessage(error: unknown): string {
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
