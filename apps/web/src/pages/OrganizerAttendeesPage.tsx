import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, getOrganizerEventAttendees } from '../lib/api'
import './OrganizerPages.css'

type AttendeeList = Awaited<ReturnType<typeof getOrganizerEventAttendees>>
type Attendee = AttendeeList['attendees'][number]

function paymentLabel(status: Attendee['paymentStatus']) {
  if (status === 'FREE') return 'Free'
  if (status === 'SUCCESSFUL') return 'Paid'
  if (status === 'REFUND_REQUIRED') return 'Refund required'
  return status.charAt(0) + status.slice(1).toLowerCase()
}

export function OrganizerAttendeesPage() {
  const { eventId } = useParams()
  const [result, setResult] = useState<AttendeeList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [paymentFilter, setPaymentFilter] = useState<'ALL' | 'FREE' | 'PAID'>('ALL')

  useEffect(() => {
    let cancelled = false
    if (!eventId) return
    void getOrganizerEventAttendees(eventId)
      .then((attendees) => {
        if (!cancelled) {
          setResult(attendees)
          setError(null)
        }
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        if (requestError instanceof ApiError && requestError.status === 404) {
          setError('This event was not found in your organizer account.')
        } else if (requestError instanceof ApiError && requestError.status === 403) {
          setError('Only the event organizer can view its attendee list.')
        } else {
          setError('We could not load this attendee list. Please try again.')
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [eventId])

  const filteredAttendees = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return (result?.attendees ?? []).filter((attendee) => {
      const matchesSearch = !normalizedSearch ||
        `${attendee.name} ${attendee.email}`.toLocaleLowerCase().includes(normalizedSearch)
      const matchesPayment = paymentFilter === 'ALL' ||
        (paymentFilter === 'FREE' ? attendee.paymentStatus === 'FREE' : attendee.paymentStatus === 'SUCCESSFUL')
      return matchesSearch && matchesPayment
    })
  }, [paymentFilter, result?.attendees, search])

  return (
    <main className="organizer-page">
      <section className="organizer-content organizer-attendees" aria-labelledby="attendees-title">
        <Link className="back-link" to="/organizer">Back to your events</Link>
        {isLoading ? (
          <p className="organizer-empty" role="status">Loading attendees…</p>
        ) : error ? (
          <div className="organizer-error" role="alert">{error}</div>
        ) : result ? (
          <>
            <div className="organizer-heading">
              <div>
                <span className="eyebrow section-eyebrow">ORGANIZER WORKSPACE</span>
                <h1 id="attendees-title">Attendees</h1>
                <p>{result.event.title}</p>
              </div>
              {result.event.status === 'CANCELLED' && (
                <span className="event-status event-status--cancelled">Cancelled</span>
              )}
            </div>

            <div className="attendee-summary" aria-label="Registration summary">
              <div><strong>{result.totalRegistrations}</strong><span>Total registrations</span></div>
              <div>
                <strong>{result.availableCapacity === null ? 'Unlimited' : result.availableCapacity}</strong>
                <span>Available capacity</span>
              </div>
              <div><strong>{result.attendees.filter(({ paymentStatus }) => paymentStatus === 'FREE').length}</strong><span>Free registrations</span></div>
              <div><strong>{result.attendees.filter(({ paymentStatus }) => paymentStatus === 'SUCCESSFUL').length}</strong><span>Paid registrations</span></div>
            </div>

            <div className="attendee-filters">
              <label>
                Search attendees
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name or email"
                />
              </label>
              <label>
                Payment
                <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as typeof paymentFilter)}>
                  <option value="ALL">All registrations</option>
                  <option value="FREE">Free</option>
                  <option value="PAID">Paid</option>
                </select>
              </label>
            </div>

            {filteredAttendees.length === 0 ? (
              <div className="organizer-empty attendee-empty" role="status">
                <h2>{result.attendees.length === 0 ? 'No registrations yet' : 'No matching attendees'}</h2>
                <p>{result.attendees.length === 0 ? 'Confirmed registrations for this event will appear here.' : 'Try a different name, email, or payment filter.'}</p>
              </div>
            ) : (
              <div className="attendee-table-wrap">
                <table className="attendee-table">
                  <caption className="sr-only">Attendees registered for {result.event.title}</caption>
                  <thead>
                    <tr><th scope="col">Attendee</th><th scope="col">Registration</th><th scope="col">Payment</th><th scope="col">Registered</th></tr>
                  </thead>
                  <tbody>
                    {filteredAttendees.map((attendee, index) => (
                      <tr key={`${attendee.email}-${attendee.registeredAt}-${index}`}>
                        <td><strong>{attendee.name}</strong><span>{attendee.email}</span></td>
                        <td><span className="attendee-status attendee-status--confirmed">Confirmed</span></td>
                        <td><span className={`attendee-status ${attendee.paymentStatus === 'SUCCESSFUL' ? 'attendee-status--paid' : attendee.paymentStatus === 'FREE' ? 'attendee-status--free' : attendee.paymentStatus === 'REFUND_REQUIRED' ? 'attendee-status--refund' : 'attendee-status--pending'}`}>{paymentLabel(attendee.paymentStatus)}</span></td>
                        <td><time dateTime={attendee.registeredAt}>{new Date(attendee.registeredAt).toLocaleString()}</time></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="attendee-privacy-note">Payment details and transaction identifiers are kept private.</p>
          </>
        ) : null}
      </section>
    </main>
  )
}
