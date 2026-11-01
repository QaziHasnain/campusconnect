import { MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CampusEvent } from '../types/event'
import { formatEventDay, formatEventMonth } from '../lib/eventFormatting'
import { EventRegistrationControl } from './EventRegistrationControl'

interface UpcomingEventRowProps {
  event: CampusEvent
  index: number
}

export function UpcomingEventRow({ event, index }: UpcomingEventRowProps) {
  return (
    <article className="upcoming-row">
      <span className="upcoming-number">{String(index + 1).padStart(2, '0')}</span>
      <div className="upcoming-date">
        <span>{formatEventMonth(event.date)}</span>
        <strong>{formatEventDay(event.date)}</strong>
      </div>
      <div className="upcoming-details">
        <span className="upcoming-category">{event.category}</span>
        <h3><Link to={`/events/${encodeURIComponent(event.id)}`}>{event.title}</Link></h3>
        <p>{event.description}</p>
      </div>
      <span className="upcoming-venue">
        <MapPin size={16} aria-hidden="true" />
        {event.venue}
      </span>
      <span className="upcoming-organizer">{event.organizerName}</span>
      <Link className="upcoming-details-link" to={`/events/${encodeURIComponent(event.id)}`}>Details</Link>
      <EventRegistrationControl
        eventId={event.id}
        eventTitle={event.title}
        ticketPricePaise={event.ticketPricePaise ?? null}
        compact
      />
    </article>
  )
}
