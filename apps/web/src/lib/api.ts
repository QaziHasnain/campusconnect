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
  venueAddress: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  ticketPricePaise: z.number().int().positive().nullable(),
  startAt: z.iso.datetime(),
  endAt: z.iso.datetime().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED']),
  capacity: z.number().int().positive().nullable(),
  registeredCount: z.number().int().nonnegative(),
  remainingSeats: z.number().int().nonnegative().nullable(),
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

export const organizerAttendeeListResponseSchema = z.object({
  event: z.object({
    id: z.string().min(1),
    title: z.string(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED']),
    capacity: z.number().int().positive().nullable(),
  }),
  totalRegistrations: z.number().int().nonnegative(),
  availableCapacity: z.number().int().nonnegative().nullable(),
  attendees: z.array(z.object({
    name: z.string(),
    email: z.string().email(),
    registeredAt: z.iso.datetime(),
    registrationStatus: z.literal('CONFIRMED'),
    paymentStatus: z.enum(['FREE', 'PENDING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'REFUND_REQUIRED']),
  })),
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

export const whatsAppPreferencesResponseSchema = z.object({
  enabled: z.boolean(),
  phoneNumber: z.string().nullable(),
  consent: z.boolean(),
  consentGrantedAt: z.iso.datetime().nullable(),
})

export const notificationPreferencesSchema = z.object({
  inAppEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  eventRemindersEnabled: z.boolean(),
  eventUpdatesEnabled: z.boolean(),
})

export const notificationItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  message: z.string(),
  type: z.enum(['EVENT_REMINDER', 'EVENT_UPDATE']),
  relatedEventId: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})

export const notificationsResponseSchema = z.object({
  notifications: z.array(notificationItemSchema),
  unreadCount: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
})

export const notificationPreferencesResponseSchema = z.object({
  preferences: notificationPreferencesSchema,
})

export const notificationReadResponseSchema = z.object({
  notification: notificationItemSchema,
})

export const notificationReadAllResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
})

export const notificationPushConfigResponseSchema = z.object({
  vapidPublicKey: z.string().nullable(),
})

export type NotificationItem = z.infer<typeof notificationItemSchema>
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>

export type ApiEvent = z.infer<typeof apiEventSchema>
export type ApiEventCategory = z.infer<typeof apiEventCategorySchema>

export const paymentStatusSchema = z.enum(['PENDING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'REFUND_REQUIRED'])

export const paymentConfigResponseSchema = z.object({
  enabled: z.boolean(),
  keyId: z.string().nullable(),
  mode: z.enum(['test', 'live']),
  message: z.string().nullable(),
})

export const paymentOrderResponseSchema = z.object({
  paymentAttemptId: z.string().min(1),
  orderId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  currency: z.literal('INR'),
  keyId: z.string().min(1),
})

export const paymentStatusResponseSchema = z.object({
  paymentAttemptId: z.string().min(1),
  status: paymentStatusSchema,
})

export const paymentVerificationResponseSchema = paymentStatusResponseSchema

export type PaymentStatus = z.infer<typeof paymentStatusSchema>

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

export const emailVerificationResponseSchema = z.object({
  message: z.string(),
})

export const verificationRequestResponseSchema = z.object({
  message: z.string(),
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

export function getPaymentConfig() {
  return apiRequest('/api/payments/config', paymentConfigResponseSchema)
}

export function createEventPaymentOrder(eventId: string) {
  return apiRequest(
    `/api/payments/events/${encodeURIComponent(eventId)}/orders`,
    paymentOrderResponseSchema,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export function verifyEventPayment(
  paymentAttemptId: string,
  paymentId: string,
  signature: string,
) {
  return apiRequest(
    '/api/payments/checkout/verify',
    paymentVerificationResponseSchema,
    {
      method: 'POST',
      body: JSON.stringify({ paymentAttemptId, paymentId, signature }),
    },
  )
}

export function getEventPaymentStatus(paymentAttemptId: string) {
  return apiRequest(
    `/api/payments/${encodeURIComponent(paymentAttemptId)}`,
    paymentStatusResponseSchema,
  )
}

export function cancelEventPayment(paymentAttemptId: string) {
  return apiRequest(
    `/api/payments/${encodeURIComponent(paymentAttemptId)}/cancel`,
    paymentStatusResponseSchema,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export function getMyRegistrations() {
  return apiRequest('/api/me/registrations', myRegistrationsResponseSchema)
}

export function getWhatsAppPreferences() {
  return apiRequest('/api/me/whatsapp', whatsAppPreferencesResponseSchema)
}

export function updateWhatsAppPreferences(phoneNumber: string, consent: boolean) {
  return apiRequest('/api/me/whatsapp', whatsAppPreferencesResponseSchema, {
    method: 'PUT',
    body: JSON.stringify({ phoneNumber, consent }),
  })
}

export function getNotifications(cursor?: string, limit = 30) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor) query.set('cursor', cursor)
  return apiRequest(`/api/me/notifications?${query}`, notificationsResponseSchema)
}

export function markNotificationRead(notificationId: string) {
  return apiRequest(
    `/api/me/notifications/${encodeURIComponent(notificationId)}/read`,
    notificationReadResponseSchema,
    { method: 'PATCH', body: JSON.stringify({}) },
  )
}

export function markAllNotificationsRead() {
  return apiRequest(
    '/api/me/notifications/read-all',
    notificationReadAllResponseSchema,
    { method: 'POST', body: JSON.stringify({}) },
  )
}

export function getNotificationPreferences() {
  return apiRequest(
    '/api/me/notifications/preferences',
    notificationPreferencesResponseSchema,
  )
}

export function updateNotificationPreferences(preferences: NotificationPreferences) {
  return apiRequest(
    '/api/me/notifications/preferences',
    notificationPreferencesResponseSchema,
    { method: 'PUT', body: JSON.stringify(preferences) },
  )
}

export function getNotificationPushConfig() {
  return apiRequest(
    '/api/me/notifications/push-config',
    notificationPushConfigResponseSchema,
  )
}

export function savePushSubscription(subscription: PushSubscriptionJSON) {
  return apiRequest(
    '/api/me/notifications/subscriptions',
    z.object({ subscribed: z.literal(true) }),
    { method: 'POST', body: JSON.stringify(subscription) },
  )
}

export function removePushSubscription(endpoint: string) {
  return apiRequest(
    '/api/me/notifications/subscriptions',
    z.undefined(),
    { method: 'DELETE', body: JSON.stringify({ endpoint }) },
  )
}

export function deleteOrganizerEvent(eventId: string) {
  return apiRequest(
    `/api/events/${encodeURIComponent(eventId)}`,
    z.undefined(),
    { method: 'DELETE' },
  )
}

export function getOrganizerEventAttendees(eventId: string) {
  return apiRequest(
    `/api/events/${encodeURIComponent(eventId)}/attendees`,
    organizerAttendeeListResponseSchema,
  )
}

export function cancelOrganizerEvent(eventId: string) {
  return apiRequest(
    `/api/events/${encodeURIComponent(eventId)}/cancel`,
    eventResponseSchema.extend({ newlyCancelled: z.boolean() }),
    { method: 'POST', body: JSON.stringify({}) },
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

export function verifyEmail(token: string) {
  return apiRequest('/api/auth/verify-email', emailVerificationResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export function resendVerification(email: string) {
  return apiRequest('/api/auth/resend-verification', verificationRequestResponseSchema, {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export function getHealth(): Promise<HealthResponse> {
  return apiRequest('/api/health', healthResponseSchema)
}
