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

const apiErrorResponseSchema = z.object({
  error: z.string(),
})

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
    let message: string | undefined
    try {
      const parsedError = apiErrorResponseSchema.safeParse(
        JSON.parse(await response.text()),
      )
      if (parsedError.success) message = parsedError.data.error
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }

    throw new ApiError(response.status, message)
  }

  if (response.status === 204) {
    const parsed = schema.safeParse(undefined)
    if (!parsed.success) {
      throw new ApiError(response.status, `API returned an invalid response (${response.status})`)
    }

    return parsed.data
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

export const apiEventCategorySchema = z.enum([
  'TECHNOLOGY',
  'CULTURAL',
  'SPORTS',
  'WORKSHOPS',
  'HACKATHONS',
])

export const apiEventSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  category: apiEventCategorySchema,
  venue: z.string(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED']),
  capacity: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  organizer: z.object({ name: z.string() }),
})

export const eventListResponseSchema = z.object({
  events: z.array(apiEventSchema),
})

export const eventResponseSchema = z.object({
  event: apiEventSchema,
})

export const myRegistrationsResponseSchema = z.object({
  registrations: z.array(
    z.object({
      id: z.string().min(1),
      eventId: z.string().min(1),
      createdAt: z.iso.datetime(),
      event: apiEventSchema,
    }),
  ),
})

export type ApiEvent = z.infer<typeof apiEventSchema>
export type ApiEventCategory = z.infer<typeof apiEventCategorySchema>

export const registrationResponseSchema = z.object({
  registration: z.object({
    id: z.string().min(1),
    eventId: z.string().min(1),
    createdAt: z.iso.datetime(),
  }),
})

export const eventRegistrationStatusResponseSchema = z.object({
  registered: z.boolean(),
})

export const authUserSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.email(),
  role: z.enum(['STUDENT', 'ORGANIZER']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const authUserResponseSchema = z.object({
  user: authUserSchema,
})

export const passwordResetRequestResponseSchema = z.object({
  message: z.string(),
})

export const passwordResetResponseSchema = z.object({
  message: z.literal('Password updated. Sign in with your new password.'),
})

export const currentUserResponseSchema = authUserResponseSchema

export const logoutResponseSchema = z.object({
  message: z.literal('Logged out'),
})

export type AuthUser = z.infer<typeof authUserSchema>

export function getEventRegistrationStatus(eventId: string) {
  return apiRequest(
    `/api/events/${encodeURIComponent(eventId)}/registration`,
    eventRegistrationStatusResponseSchema,
  )
}

export function registerForEvent(eventId: string) {
  return apiRequest(
    `/api/events/${encodeURIComponent(eventId)}/register`,
    registrationResponseSchema,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export function getMyRegistrations() {
  return apiRequest('/api/me/registrations', myRegistrationsResponseSchema)
}

export function deleteOrganizerEvent(eventId: string) {
  return apiRequest(
    `/api/events/${encodeURIComponent(eventId)}`,
    z.undefined(),
    { method: 'DELETE' },
  )
}

export function requestPasswordReset(email: string) {
  return apiRequest('/api/auth/forgot-password', passwordResetRequestResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function resetPassword(token: string, password: string) {
  return apiRequest('/api/auth/reset-password', passwordResetResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}

export function getHealth(): Promise<HealthResponse> {
  return apiRequest('/api/health', healthResponseSchema)
}
