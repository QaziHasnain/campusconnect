import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  ApiError,
  getEventRegistrationStatus,
  registerForEvent,
} from '../lib/api'

interface EventRegistrationControlProps {
  eventId: string
  eventTitle: string
  compact?: boolean
}

function getStatusErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session expired. Sign in again to check registration.'
    if (error.status === 403) return 'Only student accounts can check event registration.'
    if (error.status === 404) return 'This event is no longer available.'
    if (error.status >= 500) return 'The service is temporarily unavailable. Please try again.'
  }

  return 'Unable to check registration. Check your connection and try again.'
}

function getRegistrationErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session expired. Sign in again to register.'
    if (error.status === 403) return 'Only student accounts can register for events.'
    if (error.status === 404) return 'This event is no longer available for registration.'
    if (error.status >= 500) return 'The service is temporarily unavailable. Please try again.'
  }

  return 'Unable to register right now. Check your connection and try again.'
}

export function EventRegistrationControl({
  eventId,
  eventTitle,
  compact = false,
}: EventRegistrationControlProps) {
  const { user, isChecking } = useAuth()
  const userId = user?.id
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [statusUserId, setStatusUserId] = useState<string | null>(null)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [requiresSignIn, setRequiresSignIn] = useState(false)
  const requestId = useRef(0)
  const submissionPending = useRef(false)

  const loadStatus = useCallback(async (preserveMessage = false) => {
    if (!userId) return

    const currentRequestId = ++requestId.current
    const currentUserId = userId

    try {
      const { registered: isRegistered } = await getEventRegistrationStatus(eventId)
      if (currentRequestId !== requestId.current) return
      setRegistered(isRegistered)
      setStatusUserId(currentUserId)
      if (preserveMessage && isRegistered) setMessage('Your registration is confirmed.')
      if (!preserveMessage) setMessage(null)
      setRequiresSignIn(false)
    } catch (error) {
      if (currentRequestId !== requestId.current) return
      setRegistered(null)
      setStatusUserId(currentUserId)
      setMessage((currentMessage) =>
        preserveMessage && currentMessage ? currentMessage : getStatusErrorMessage(error),
      )
      setRequiresSignIn(error instanceof ApiError && error.status === 401)
    } finally {
      if (currentRequestId === requestId.current) setIsCheckingStatus(false)
    }
  }, [eventId, userId])

  useEffect(() => {
    if (isChecking || user?.role !== 'STUDENT') return

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadStatus()
    })
    return () => {
      cancelled = true
      requestId.current += 1
    }
  }, [isChecking, loadStatus, user?.role])

  function retryStatus() {
    setIsCheckingStatus(true)
    setMessage(null)
    setRequiresSignIn(false)
    void loadStatus()
  }

  async function handleRegister() {
    if (submissionPending.current) return

    submissionPending.current = true
    setIsSubmitting(true)
    setMessage(null)
    setRequiresSignIn(false)

    try {
      await registerForEvent(eventId)
      setRegistered(true)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.message === 'Event is full') {
          setRegistered(false)
          setMessage('This event is full and can no longer accept registrations.')
        } else if (error.message === 'Already registered for this event') {
          setRegistered(true)
          setMessage('You are already registered for this event.')
        } else {
          setRegistered(null)
          setMessage('We could not confirm your registration. Please check its status.')
          setIsCheckingStatus(true)
          void loadStatus(true)
        }
      } else {
        setRegistered(null)
        setMessage(getRegistrationErrorMessage(error))
        setRequiresSignIn(error instanceof ApiError && error.status === 401)
        if (!(error instanceof ApiError) || error.status >= 500) {
          setIsCheckingStatus(true)
          void loadStatus(true)
        }
      }
    } finally {
      submissionPending.current = false
      setIsSubmitting(false)
    }
  }

  if (isChecking || user?.role === 'ORGANIZER') return null

  if (!user) {
    return (
      <div className={`event-registration-control${compact ? ' event-registration-control--compact' : ''}`}>
        <Link className="button registration-button" to="/login">
          {compact ? 'Sign in' : 'Sign in to register'}
        </Link>
      </div>
    )
  }

  return (
    <div
      className={`event-registration-control${compact ? ' event-registration-control--compact' : ''}`}
      aria-live="polite"
    >
      {registered ? (
        <span className="registration-status" role="status">Registered</span>
      ) : isCheckingStatus || statusUserId !== user.id ? (
        <button className="button registration-button" type="button" disabled>
          Checking…
        </button>
      ) : registered === null ? (
        <button
          className="button registration-button"
          type="button"
          onClick={retryStatus}
        >
          Try again
        </button>
      ) : (
        <button
          className="button registration-button"
          type="button"
          onClick={() => void handleRegister()}
          disabled={isSubmitting}
          aria-label={`Register for ${eventTitle}`}
        >
          {isSubmitting ? 'Registering…' : 'Register'}
        </button>
      )}
      {message && <span className="registration-message" role="alert">{message}</span>}
      {requiresSignIn && (
        <Link className="registration-sign-in" to="/login">Sign in</Link>
      )}
    </div>
  )
}
