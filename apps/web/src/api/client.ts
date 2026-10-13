import type { ZodType } from 'zod'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type ApiInit<T = unknown> = {
  method?: string
  body?: unknown
  schema?: ZodType<T>
  signal?: AbortSignal
}

/** Absolute path of an API route, e.g. `apiUrl('/projects')` → `/api/projects`. */
export const apiUrl = (path: string) => `/api${path}`

export async function toApiError(response: Response): Promise<ApiError> {
  let code = 'internal'
  let message = response.statusText || `Request failed (${response.status})`
  let details: Record<string, unknown> = {}
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const error = body.error
      if (error && typeof error === 'object' && !Array.isArray(error)) {
        const {
          code: c,
          message: m,
          ...rest
        } = error as Record<string, unknown>
        if (typeof c === 'string') code = c
        if (typeof m === 'string') message = m
        details = rest
      }
    }
  } catch {
    // not JSON: keep the HTTP status text
  }
  return new ApiError(response.status, code, message, details)
}

/**
 * Calls an `/api` route. Non-GET requests always carry a body: JSON (`{}` when
 * none is given) or the given `FormData` (multipart).
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: ApiInit<T> = {}
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = { Accept: 'application/json' }
  let body: BodyInit | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    if (init.body instanceof FormData) {
      body = init.body
    } else {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.body ?? {})
    }
  }

  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: init.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw new ApiError(0, 'network', errorMessage(err))
  }

  if (!response.ok) throw await toApiError(response)

  let data: unknown
  if (response.status !== 204 && method !== 'HEAD') {
    const contentType = response.headers.get('content-type') ?? ''
    try {
      data = contentType.toLowerCase().includes('application/json')
        ? await response.json()
        : await response.text()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      if (!(err instanceof SyntaxError)) {
        throw new ApiError(0, 'network', errorMessage(err))
      }
      throw new ApiError(
        response.status,
        'invalid_response',
        'The server returned an unreadable response.'
      )
    }
  }
  if (!init.schema) return data as T
  const parsed = init.schema.safeParse(data)
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server returned an invalid response.'
    )
  }
  return parsed.data
}

export function isApiError(err: unknown, code?: string): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code)
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
