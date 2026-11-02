import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  ApiError,
  cancelEventPayment,
  createEventPaymentOrder,
  getEventPaymentStatus,
  getEventRegistrationStatus,
  getPaymentConfig,
  registerForEvent,
  verifyEventPayment,
} from '../lib/api'
import type { PaymentStatus } from '../lib/api'
import { notifyEventRegistrationChanged } from '../lib/eventAvailability'

interface RazorpayCheckoutResult {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface RazorpayFailureResult {
  error?: {
    description?: string
  }
}

interface RazorpayCheckoutInstance {
  open(): void
  on(eventName: 'payment.failed', callback: (result: RazorpayFailureResult) => void): void
}

interface RazorpayCheckoutOptions {
  key: string
  amount: number
  currency: 'INR'
  name: string
  description: string
  order_id: string
  prefill: { name: string; email: string }
  theme: { color: string }
  handler(result: RazorpayCheckoutResult): void
  modal: { ondismiss(): void }
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance
  }
}

interface EventRegistrationControlProps {
  eventId: string
  eventTitle: string
  ticketPricePaise?: number | null
  compact?: boolean
}

let checkoutScriptPromise: Promise<void> | null = null

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve()
  if (checkoutScriptPromise) return checkoutScriptPromise

  checkoutScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => {
      if (window.Razorpay) resolve()
      else reject(new Error('Razorpay Checkout did not initialize'))
    }
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded'))
    document.body.appendChild(script)
  }).catch((error: unknown) => {
    checkoutScriptPromise = null
    throw error
  })

  return checkoutScriptPromise
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
    if (error.status === 409 && error.message === 'Event is full') {
      return 'This event is full and can no longer accept registrations.'
    }
    if (error.status === 409 && error.message === 'Event has been cancelled') {
      return 'This event was cancelled. Registration is closed.'
    }
    if (error.status >= 500) return 'The service is temporarily unavailable. Please try again.'
  }

  return 'Unable to register right now. Check your connection and try again.'
}

function paymentErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session expired. Sign in again to continue.'
    if (error.status === 403) return 'Only student accounts can purchase tickets.'
    if (error.status === 404) return 'This event or payment attempt is no longer available.'
    if (error.status === 409) return error.message
    if (error.status === 503) return error.message
    if (error.status >= 500) return 'Payment service is temporarily unavailable. Please try again.'
  }
  if (error instanceof Error && error.message.includes('Razorpay Checkout')) {
    return 'Razorpay Checkout could not be loaded. Check your connection and retry.'
  }
  return 'We could not start or verify this payment. You can safely retry.'
}

function formatPrice(amountPaise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amountPaise / 100)
}

export function EventRegistrationControl({
  eventId,
  eventTitle,
  ticketPricePaise = null,
  compact = false,
}: EventRegistrationControlProps) {
  const { user, isChecking } = useAuth()
  const userId = user?.id
  const isPaidEvent = ticketPricePaise !== null && ticketPricePaise > 0
  const [registered, setRegistered] = useState<boolean | null>(null)
  const [statusUserId, setStatusUserId] = useState<string | null>(null)
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [requiresSignIn, setRequiresSignIn] = useState(false)
  const [paymentConfig, setPaymentConfig] = useState<{
    enabled: boolean
    keyId: string | null
    message: string | null
  } | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | null>(null)
  const [paymentAttemptId, setPaymentAttemptId] = useState<string | null>(null)
  const requestId = useRef(0)
  const submissionPending = useRef(false)
  const completedAttemptId = useRef<string | null>(null)

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

  useEffect(() => {
    if (isChecking || user?.role !== 'STUDENT' || !isPaidEvent) return

    let cancelled = false
    void getPaymentConfig()
      .then((configuration) => {
        if (!cancelled) {
          setPaymentConfig({
            enabled: configuration.enabled,
            keyId: configuration.keyId,
            message: configuration.message,
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPaymentConfig({
            enabled: false,
            keyId: null,
            message: 'Payment configuration could not be checked. Please retry later.',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [isChecking, isPaidEvent, user?.role])

  async function checkPaymentStatus(attemptId: string) {
    const result = await getEventPaymentStatus(attemptId)
    setPaymentStatus(result.status)
    if (result.status === 'SUCCESSFUL') {
      setRegistered(true)
      setMessage('Payment successful. Your registration is confirmed.')
      notifyEventRegistrationChanged(eventId)
    } else if (result.status === 'REFUND_REQUIRED') {
      setMessage('Payment was captured after event cancellation. No refund has been issued. Contact the organizer about a manual refund.')
    }
    return result.status
  }

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
      notifyEventRegistrationChanged(eventId)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.message === 'Event is full') {
          setRegistered(false)
          setMessage('This event is full and can no longer accept registrations.')
        } else if (error.message === 'Event has been cancelled') {
          setRegistered(false)
          setMessage('This event was cancelled. Registration is closed.')
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

  async function handlePayment() {
    if (submissionPending.current || !paymentConfig?.enabled || !paymentConfig.keyId) return

    submissionPending.current = true
    setIsSubmitting(true)
    setMessage(null)
    setRequiresSignIn(false)

    try {
      await loadRazorpayCheckout()
      const order = await createEventPaymentOrder(eventId)
      setPaymentAttemptId(order.paymentAttemptId)
      setPaymentStatus('PENDING')
      const Checkout = window.Razorpay
      if (!Checkout) throw new Error('Razorpay Checkout did not initialize')

      const checkout = new Checkout({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'CampusConnect',
        description: eventTitle,
        order_id: order.orderId,
        prefill: { name: user?.name ?? '', email: user?.email ?? '' },
        theme: { color: '#765fd4' },
        handler: (result) => {
          completedAttemptId.current = order.paymentAttemptId
          void verifyEventPayment(
            order.paymentAttemptId,
            result.razorpay_payment_id,
            result.razorpay_signature,
          )
            .then(({ status }) => {
              setPaymentStatus(status)
              if (status === 'SUCCESSFUL') {
                setRegistered(true)
                setMessage('Payment successful. Your registration is confirmed.')
                notifyEventRegistrationChanged(eventId)
              } else if (status === 'REFUND_REQUIRED') {
                setMessage('Payment was captured after event cancellation. No refund has been issued. Contact the organizer about a manual refund.')
              } else {
                setMessage('Payment is being confirmed. Check its status before trying again.')
              }
            })
            .catch((error: unknown) => {
              setPaymentStatus('PENDING')
              setMessage(paymentErrorMessage(error))
            })
        },
        modal: {
          ondismiss: () => {
            if (completedAttemptId.current === order.paymentAttemptId) return
            void cancelEventPayment(order.paymentAttemptId)
              .then(({ status }) => setPaymentStatus(status))
              .catch(() => setPaymentStatus('PENDING'))
            setMessage('Payment was cancelled. You can safely retry.')
          },
        },
      })
      checkout.on('payment.failed', (result) => {
        setMessage(result.error?.description || 'Payment was not completed. You can retry.')
        void checkPaymentStatus(order.paymentAttemptId).catch(() => setPaymentStatus('PENDING'))
      })
      checkout.open()
    } catch (error) {
      setMessage(paymentErrorMessage(error))
      setRequiresSignIn(error instanceof ApiError && error.status === 401)
      if (error instanceof ApiError && error.status === 409 && error.message !== 'Event has been cancelled') {
        setPaymentStatus('FAILED')
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
          {compact ? 'Sign in' : isPaidEvent ? 'Sign in to purchase' : 'Sign in to register'}
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
      ) : isPaidEvent ? (
        <>
          {paymentConfig?.enabled ? (
            <button
              className="button registration-button"
              type="button"
              onClick={() => void handlePayment()}
              disabled={isSubmitting || paymentStatus === 'REFUND_REQUIRED'}
              aria-label={`Pay ${formatPrice(ticketPricePaise)} and register for ${eventTitle}`}
            >
              {isSubmitting
                ? 'Opening checkout…'
                : paymentStatus === 'REFUND_REQUIRED'
                  ? 'Payment captured'
                : paymentStatus === 'FAILED' || paymentStatus === 'CANCELLED'
                  ? `Retry · ${formatPrice(ticketPricePaise)}`
                  : `${compact ? 'Pay' : 'Pay and register'} · ${formatPrice(ticketPricePaise)}`}
            </button>
          ) : (
            <span className="registration-message" role="status">
              {paymentConfig?.message ?? 'Checking Razorpay test-mode configuration…'}
            </span>
          )}
          {paymentStatus && (
            <span className={`payment-status payment-status--${paymentStatus.toLowerCase()}`} role="status">
              {paymentStatus === 'REFUND_REQUIRED' ? 'Manual refund required' : `Payment ${paymentStatus.toLowerCase()}`}
            </span>
          )}
          {paymentAttemptId && paymentStatus === 'PENDING' && (
            <button
              className="registration-sign-in"
              type="button"
              onClick={() => void checkPaymentStatus(paymentAttemptId).catch(() => {
                setMessage('Payment status could not be checked. Please try again.')
              })}
            >
              Check payment status
            </button>
          )}
        </>
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
