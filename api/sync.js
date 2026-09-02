const DEFAULT_GAS_WEB_APP_URL =
  'https://script.google.com/macros/s/AKfycbzlzn1Q9C2lppXa7E8Zo1UH4QfWAvXf6ufqP0hPw7Vmvdb_hr5RduxT5iLQVIfKI4R3/exec'

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ success: false, message: 'Method not allowed' })
  }

  const upstreamUrl = new URL(
    process.env.GAS_WEB_APP_URL || DEFAULT_GAS_WEB_APP_URL,
  )

  if (request.method === 'GET') {
    const incomingUrl = new URL(request.url, 'https://local.invalid')
    incomingUrl.searchParams.forEach((value, key) => {
      upstreamUrl.searchParams.append(key, value)
    })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)

  try {
    let body
    if (request.method === 'POST') {
      body = typeof request.body === 'string'
        ? request.body
        : JSON.stringify(request.body || {})
    }

    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: request.method === 'POST'
        ? { 'Content-Type': 'text/plain;charset=utf-8' }
        : undefined,
      body,
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    })
    const text = await upstream.text()

    response.setHeader('Cache-Control', 'no-store, max-age=0')
    response.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    )
    return response.status(upstream.status).send(text)
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    return response.status(timedOut ? 504 : 502).json({
      success: false,
      message: timedOut
        ? 'Google Sheets took too long to respond'
        : 'Could not reach Google Sheets',
    })
  } finally {
    clearTimeout(timer)
  }
}
