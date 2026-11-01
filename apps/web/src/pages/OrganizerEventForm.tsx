import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { ApiError, apiRequest, eventListResponseSchema, eventResponseSchema } from '../lib/api'
import type { ApiEvent } from '../lib/api'
import { isValidVenueCoordinates } from '../lib/venueMapUtils'
import './OrganizerPages.css'

const VenueMap = lazy(() =>
  import('../components/VenueMap').then((module) => ({ default: module.VenueMap })),
)

const categorySchema = z.enum([
  'TECHNOLOGY',
  'CULTURAL',
  'SPORTS',
  'WORKSHOPS',
  'HACKATHONS',
])

const formSchema = z.object({
  title: z.string().trim().min(1, 'Enter an event title.').max(200, 'Title must be 200 characters or fewer.'),
  description: z.string().trim().min(1, 'Enter an event description.').max(5000, 'Description must be 5000 characters or fewer.'),
  category: categorySchema,
  venue: z.string().trim().min(1, 'Enter a venue.').max(200, 'Venue must be 200 characters or fewer.'),
  venueAddress: z.string().max(300, 'Venue address must be 300 characters or fewer.'),
  latitude: z.string(),
  longitude: z.string(),
  ticketPriceInRupees: z.string(),
  startAt: z.string().min(1, 'Choose a start date and time.'),
  endAt: z.string(),
  capacity: z.string(),
  status: z.enum(['DRAFT', 'PUBLISHED']),
}).superRefine((values, context) => {
  if (values.endAt && new Date(values.endAt) < new Date(values.startAt)) {
    context.addIssue({
      code: 'custom',
      path: ['endAt'],
      message: 'End date must be on or after the start date.',
    })
  }
  if (values.capacity && (!Number.isInteger(Number(values.capacity)) || Number(values.capacity) < 1)) {
    context.addIssue({
      code: 'custom',
      path: ['capacity'],
      message: 'Capacity must be a positive whole number.',
    })
  }
  if (Boolean(values.latitude) !== Boolean(values.longitude)) {
    context.addIssue({
      code: 'custom',
      path: ['latitude'],
      message: 'Choose both a latitude and longitude, or clear both fields.',
    })
  } else if (
    values.latitude &&
    !isValidVenueCoordinates(Number(values.latitude), Number(values.longitude))
  ) {
    context.addIssue({
      code: 'custom',
      path: ['latitude'],
      message: 'Enter valid latitude and longitude coordinates.',
    })
  }
  if (
    values.ticketPriceInRupees &&
    !/^\d+(?:\.\d{1,2})?$/.test(values.ticketPriceInRupees)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['ticketPriceInRupees'],
      message: 'Enter a ticket price with up to two decimal places.',
    })
  } else   if (
    values.ticketPriceInRupees &&
    toTicketPricePaise(values.ticketPriceInRupees) === null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['ticketPriceInRupees'],
      message: 'Ticket price is too large.',
    })
  }
})
type EventFormValues = z.infer<typeof formSchema>

const categories = [
  ['TECHNOLOGY', 'Technology'],
  ['CULTURAL', 'Cultural'],
  ['SPORTS', 'Sports'],
  ['WORKSHOPS', 'Workshops'],
  ['HACKATHONS', 'Hackathons'],
] as const

function toLocalDateTime(value: string) {
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toTicketPricePaise(value: string) {
  if (!value) return null
  const [wholeRupees, paise = ''] = value.split('.')
  const amountPaise = Number(wholeRupees) * 100 + Number(paise.padEnd(2, '0'))
  return Number.isSafeInteger(amountPaise) ? amountPaise : null
}

function eventToForm(event: ApiEvent) {
  return {
    title: event.title,
    description: event.description,
    category: event.category,
    venue: event.venue,
    venueAddress: event.venueAddress ?? '',
    latitude: event.latitude?.toString() ?? '',
    longitude: event.longitude?.toString() ?? '',
    ticketPriceInRupees:
      event.ticketPricePaise === null ? '' : (event.ticketPricePaise / 100).toFixed(2),
    startAt: toLocalDateTime(event.startAt),
    endAt: event.endAt ? toLocalDateTime(event.endAt) : '',
    capacity: event.capacity?.toString() ?? '',
    status: event.status,
  }
}

const emptyForm = {
  title: '',
  description: '',
  category: 'TECHNOLOGY' as const,
  venue: '',
  venueAddress: '',
  latitude: '',
  longitude: '',
  ticketPriceInRupees: '',
  startAt: '',
  endAt: '',
  capacity: '',
  status: 'DRAFT' as const,
}

export function OrganizerEventForm() {
  const { eventId } = useParams()
  const navigate = useNavigate()
  const [values, setValues] = useState<EventFormValues>(emptyForm)
  const [isLoading, setIsLoading] = useState(Boolean(eventId))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!eventId) return

    let cancelled = false
    void apiRequest('/api/events/mine', eventListResponseSchema)
      .then(({ events }) => {
        if (cancelled) return
        const event = events.find((item) => item.id === eventId)
        if (!event) {
          setError('This event was not found in your organizer account.')
          return
        }
        setValues(eventToForm(event))
      })
      .catch(() => {
        if (!cancelled) setError('We could not load this event. Please try again.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [eventId])

  function updateField<Field extends keyof EventFormValues>(
    field: Field,
    value: EventFormValues[Field],
  ) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function selectVenuePosition({ latitude, longitude }: { latitude: number; longitude: number }) {
    setValues((current) => ({
      ...current,
      latitude: latitude.toString(),
      longitude: longitude.toString(),
    }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const parsed = formSchema.safeParse(values)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the event details and try again.')
      return
    }

    const payload = {
      title: parsed.data.title,
      description: parsed.data.description,
      category: parsed.data.category,
      venue: parsed.data.venue,
      venueAddress: parsed.data.venueAddress.trim() || null,
      latitude: parsed.data.latitude ? Number(parsed.data.latitude) : null,
      longitude: parsed.data.longitude ? Number(parsed.data.longitude) : null,
      ticketPricePaise: toTicketPricePaise(parsed.data.ticketPriceInRupees) || null,
      startAt: new Date(parsed.data.startAt).toISOString(),
      endAt: parsed.data.endAt ? new Date(parsed.data.endAt).toISOString() : null,
      capacity: parsed.data.capacity ? Number(parsed.data.capacity) : null,
      ...(eventId ? { status: parsed.data.status } : {}),
    }

    setIsSubmitting(true)
    try {
      await apiRequest(
        eventId ? `/api/events/${encodeURIComponent(eventId)}` : '/api/events',
        eventResponseSchema,
        { method: eventId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      )
      navigate('/organizer', {
        replace: true,
        state: { notice: eventId ? 'Event changes saved.' : 'Event created as a draft.' },
      })
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 400
          ? requestError.message
          : requestError instanceof ApiError && requestError.status === 403
            ? 'You can only manage events assigned to your organizer account.'
            : requestError instanceof ApiError && requestError.status >= 500
              ? 'The event service is temporarily unavailable. Please try again.'
              : 'We could not save this event. Please try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const latitude = values.latitude ? Number(values.latitude) : null
  const longitude = values.longitude ? Number(values.longitude) : null
  const mapPosition =
    latitude !== null &&
    longitude !== null &&
    isValidVenueCoordinates(latitude, longitude)
      ? { latitude, longitude }
      : null

  return (
    <main className="organizer-page">
      <section className="organizer-content organizer-form-content" aria-labelledby="event-form-title">
        <div className="organizer-heading">
          <div>
            <span className="eyebrow section-eyebrow">ORGANIZER WORKSPACE</span>
            <h1 id="event-form-title">{eventId ? 'Edit event' : 'Create an event'}</h1>
            <p>Enter the event details. New events start as drafts.</p>
          </div>
          <Link className="text-button" to="/organizer">Back to dashboard</Link>
        </div>

        {isLoading ? (
          <p className="organizer-empty" role="status">Loading event…</p>
        ) : (
          <form className="organizer-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <label htmlFor="event-title">Event title</label>
            <input id="event-title" maxLength={200} required value={values.title} onChange={(event) => updateField('title', event.target.value)} />

            <label htmlFor="event-description">Description</label>
            <textarea id="event-description" maxLength={5000} required rows={5} value={values.description} onChange={(event) => updateField('description', event.target.value)} />

            <div className="organizer-form-grid">
              <div>
                <label htmlFor="event-category">Category</label>
                <select id="event-category" value={values.category} onChange={(event) => updateField('category', categorySchema.parse(event.target.value))}>
                  {categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="event-venue">Venue</label>
                <input id="event-venue" maxLength={200} required value={values.venue} onChange={(event) => updateField('venue', event.target.value)} />
              </div>
              <div>
                <label htmlFor="event-venue-address">Venue address (optional)</label>
                <input id="event-venue-address" maxLength={300} value={values.venueAddress} onChange={(event) => updateField('venueAddress', event.target.value)} />
              </div>
              <div>
                <label htmlFor="event-ticket-price">Ticket price (INR; leave blank for free)</label>
                <input id="event-ticket-price" inputMode="decimal" placeholder="0.00" value={values.ticketPriceInRupees} onChange={(event) => updateField('ticketPriceInRupees', event.target.value)} />
              </div>
              <div>
                <label htmlFor="event-start">Start date and time</label>
                <input id="event-start" type="datetime-local" required value={values.startAt} onChange={(event) => updateField('startAt', event.target.value)} />
              </div>
              <div>
                <label htmlFor="event-end">End date and time</label>
                <input id="event-end" type="datetime-local" value={values.endAt} onChange={(event) => updateField('endAt', event.target.value)} />
              </div>
              <div>
                <label htmlFor="event-capacity">Capacity (optional)</label>
                <input id="event-capacity" type="number" min={1} step={1} value={values.capacity} onChange={(event) => updateField('capacity', event.target.value)} />
              </div>
              {eventId && (
                <div>
                  <label htmlFor="event-status">Publication status</label>
                  <select id="event-status" value={values.status} onChange={(event) => updateField('status', z.enum(['DRAFT', 'PUBLISHED']).parse(event.target.value))}>
                    <option value="DRAFT">Draft (unpublished)</option>
                    <option value="PUBLISHED">Published</option>
                  </select>
                </div>
              )}
            </div>

            <section className="venue-picker" aria-labelledby="venue-picker-title">
              <div>
                <h2 id="venue-picker-title">Map location (optional)</h2>
                <p>Select the venue on the map or enter its coordinates. No location is saved until you choose one.</p>
              </div>
              <div className="organizer-form-grid venue-coordinate-fields">
                <div>
                  <label htmlFor="event-latitude">Latitude</label>
                  <input id="event-latitude" type="number" min={-90} max={90} step="any" value={values.latitude} onChange={(event) => updateField('latitude', event.target.value)} />
                </div>
                <div>
                  <label htmlFor="event-longitude">Longitude</label>
                  <input id="event-longitude" type="number" min={-180} max={180} step="any" value={values.longitude} onChange={(event) => updateField('longitude', event.target.value)} />
                </div>
              </div>
              <Suspense fallback={<p role="status">Loading venue map…</p>}>
                <VenueMap
                  position={mapPosition}
                  onSelect={selectVenuePosition}
                  className="venue-map-shell--picker"
                  ariaLabel="Select the event venue on the map"
                />
              </Suspense>
              <p className="venue-map-attribution-note">Map data © OpenStreetMap contributors. The public tile service is best-effort and may be rate-limited.</p>
            </section>

            {error && <p className="organizer-error" role="alert">{error}</p>}
            <div className="organizer-form-actions">
              <Link className="button organizer-button" to="/organizer">Cancel</Link>
              <button className="button button-primary" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : eventId ? 'Save changes' : 'Create draft'}
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}
