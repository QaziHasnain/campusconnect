import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { EventCard } from '../components/EventCard'
import { WhatsAppPreferences } from './WhatsAppPreferences'
import {
  ApiError,
  getMyRegistrations,
} from '../lib/api'
import { toCampusEvent } from '../lib/events'
import type { CampusEvent } from '../types/event'
import '../App.css'

function getRegistrationsErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session expired. Sign in again to view registrations.'
    if (error.status === 403) return 'Only student accounts can view registrations.'
    if (error.status >= 500) return 'The service is temporarily unavailable. Please try again.'
  }

  return 'Unable to load your registrations. Check your connection and try again.'
}

export function MyRegistrationsPage() {
  const { user, isChecking } = useAuth()
  const [events, setEvents] = useState<CampusEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (isChecking || user?.role !== 'STUDENT') return

    let cancelled = false

    void (async () => {
      const { registrations } = await getMyRegistrations()

      if (!cancelled) {
        setEvents(registrations.map(({ event }) => toCampusEvent(event)))
        setLoadedUserId(user.id)
        setError(null)
      }
    })()
      .catch((requestError: unknown) => {
        if (cancelled) return
        setEvents([])
        setLoadedUserId(user.id)
        setError(getRegistrationsErrorMessage(requestError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isChecking, retry, user?.id, user?.role])

  const isLoadingRegistrations =
    user?.role === 'STUDENT' && (isLoading || loadedUserId !== user.id)

  return (
    <main>
        <section className="registrations-section section-wrap" aria-labelledby="registrations-title">
          <span className="eyebrow section-eyebrow">YOUR CAMPUS PLANS</span>
          <h1 id="registrations-title">My registrations</h1>
          <p className="registrations-description">
            Events you have registered for with this student account.
          </p>

          {!isChecking && user?.role === 'STUDENT' && <WhatsAppPreferences />}

          {isChecking ? (
            <div className="empty-state" role="status">Checking your sign-in status…</div>
          ) : !user ? (
            <div className="empty-state">
              <h2>Sign in to see your registrations.</h2>
              <p>Your registrations are private to your student account.</p>
              <Link className="button button-primary" to="/login">Sign in</Link>
            </div>
          ) : user.role !== 'STUDENT' ? (
            <div className="empty-state" role="status">
              <h2>Student registrations are not available for organizer accounts.</h2>
              <p>Sign in with a student account to view event registrations.</p>
            </div>
          ) : isLoadingRegistrations ? (
            <div className="empty-state" role="status" aria-live="polite">
              <p>Loading your registrations…</p>
            </div>
          ) : error ? (
            <div className="empty-state" role="alert">
              <h2>Registrations unavailable</h2>
              <p>{error}</p>
              {error.includes('Sign in again') && (
                <Link className="button button-primary" to="/login">Sign in</Link>
              )}
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setIsLoading(true)
                  setError(null)
                  setRetry((attempt) => attempt + 1)
                }}
              >
                Try again
              </button>
            </div>
          ) : events.length === 0 ? (
            <div className="empty-state" role="status">
              <h2>No registrations yet.</h2>
              <p>Find an event on campus and register to see it here.</p>
              <Link className="button button-primary" to="/">Browse events</Link>
            </div>
          ) : (
            <div className="featured-grid">
              {events.map((event) => (
                <EventCard
                  event={event}
                  key={event.id}
                  showRegistrationControl={false}
                  registrationControl={
                    <span className="registration-status" role="status">Registered</span>
                  }
                />
              ))}
            </div>
          )}
        </section>
    </main>
  )
}
