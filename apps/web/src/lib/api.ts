import { z } from 'zod'

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(
  /\/+$/,
  '',
)

export class ApiError extends Error {
  readonly status: number

  constructor(
    status: number,
    message = `API request failed (${status})`,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  options: Omit<RequestInit, 'credentials'> = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const requestPath = path.startsWith('/') ? path : `/${path}`
  const response = await fetch(`${API_BASE_URL}${requestPath}`, {
    ...options,
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    throw new ApiError(response.status)
  }

  let data: unknown
  try {
    data = JSON.parse(await response.text())
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ApiError(response.status, `API returned invalid JSON (${response.status})`)
    }

    throw error
  }

  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    throw new ApiError(response.status, `API returned an invalid response (${response.status})`)
  }

  return parsed.data
}

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

export function getHealth(): Promise<HealthResponse> {
  return apiRequest('/api/health', healthResponseSchema)
}
