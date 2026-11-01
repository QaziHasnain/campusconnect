import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ApiError,
  apiRequest,
  deleteOrganizerEvent,
  eventListResponseSchema,
  eventResponseSchema,
} from '../lib/api'
import type { ApiEvent } from '../lib/api'
import './OrganizerPages.css'

export function OrganizerDashboard() {
  const location = useLocation()
  const [events, setEvents] = useState<ApiEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState(
    typeof location.state?.notice === 'string' ? location.state.notice : null,
  )

  useEffect(() => {
    let cancelled = false
    void apiRequest('/api/events/mine', eventListResponseSchema)
      .then(({ events: ownedEvents }) => {
        if (!cancelled) {
          setEvents(ownedEvents)
          setError(null)
        }
      })
      .catch(() => {
        if (!cancelled) setError('We could not load your events. Please try again.')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function togglePublication(event: ApiEvent) {
    setError(null)
    setNotice(null)
    try {
      const status = event.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
      const response = await apiRequest(
        `/api/events/${encodeURIComponent(event.id)}`,
        eventResponseSchema,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      )
      setEvents((currentEvents) =>
        currentEvents.map((current) => current.id === event.id ? response.event : current),
      )
      setNotice(status === 'PUBLISHED' ? 'Event published.' : 'Event unpublished and saved as a draft.')
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We could not update this event. Please try again.',
      )
    }
  }

  async function deleteEvent(event: ApiEvent) {
    if (!window.confirm(`Delete "${event.title}"? This action cannot be undone.`)) return

    setError(null)
    setNotice(null)
    try {
      await deleteOrganizerEvent(event.id)
      setEvents((currentEvents) => currentEvents.filter((current) => current.id !== event.id))
      setNotice('Event deleted.')
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We could not delete this event. Please try again.',
      )
    }
  }

  return (
    <main className="organizer-page">
      <section className="organizer-content" aria-labelledby="organizer-title">
        <div className="organizer-heading">
          <div>
            <span className="eyebrow section-eyebrow">ORGANIZER WORKSPACE</span>
            <h1 id="organizer-title">Your events</h1>
            <p>Create, update, and publish campus events from one place.</p>
          </div>
          <Link className="button button-primary" to="/organizer/events/new">
            Create event
          </Link>
        </div>

        {notice && <p className="organizer-notice" role="status">{notice}</p>}
        {error && <p className="organizer-error" role="alert">{error}</p>}

        {isLoading ? (
          <p className="organizer-empty" role="status">Loading your events…</p>
        ) : events.length === 0 && !error ? (
          <div className="organizer-empty">
            <h2>No events yet</h2>
            <p>Events you create will appear here. Start with a draft and publish it when it’s ready.</p>
            <Link className="button button-primary" to="/organizer/events/new">Create your first event</Link>
          </div>
        ) : (
          <div className="organizer-event-list">
            {events.map((event) => (
              <article className="organizer-event" key={event.id}>
                <div className="organizer-event-details">
                  <div className="organizer-event-title">
                    <h2>{event.title}</h2>
                    <span className={`event-status event-status--${event.status.toLowerCase()}`}>
                      {event.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  <p>{event.category} · {event.venue}</p>
                  <time dateTime={event.startAt}>
                    {new Date(event.startAt).toLocaleString()}
                  </time>
                </div>
                <div className="organizer-event-actions">
                  <Link className="button organizer-button" to={`/organizer/events/${encodeURIComponent(event.id)}/edit`}>
                    Edit
                  </Link>
                  <button
                    className="button organizer-button"
                    type="button"
                    onClick={() => void togglePublication(event)}
                  >
                    {event.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                  </button>
                  <button
                    className="button organizer-button organizer-button--danger"
                    type="button"
                    onClick={() => void deleteEvent(event)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
