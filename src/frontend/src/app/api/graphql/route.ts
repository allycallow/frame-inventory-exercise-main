export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    return Response.json(
      { errors: [{ message: 'GraphQL requests must use application/json.' }] },
      { status: 415, headers: { 'cache-control': 'no-store' } },
    )
  }
  const headers = new Headers({ 'content-type': 'application/json' })
  const authorization = request.headers.get('authorization')
  if (authorization) headers.set('authorization', authorization)

  try {
    const upstream = await fetch(process.env.BFF_URL || 'http://127.0.0.1:4000', {
      method: 'POST',
      headers,
      body: await request.text(),
      cache: 'no-store',
      redirect: 'error',
      signal: request.signal,
    })
    const resultHeaders = new Headers({
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    })
    const correlation = upstream.headers.get('x-correlation-id')
    if (correlation) resultHeaders.set('x-correlation-id', correlation)
    return new Response(upstream.body, { status: upstream.status, headers: resultHeaders })
  } catch {
    return Response.json(
      { errors: [{ message: 'Inventory service is unavailable. Try again shortly.' }] },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
}
