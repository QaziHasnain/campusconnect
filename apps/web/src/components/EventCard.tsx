import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Code2,
  Cpu,
  Palette,
  Trophy,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { CampusEvent, EventCategory } from '../types/event'
import { formatEventDate, formatEventShortDate } from '../lib/eventFormatting'
import { formatTicketPrice } from '../lib/priceFormatting'
import { formatRemainingSeats } from '../lib/eventAvailability'
import { EventRegistrationControl } from './EventRegistrationControl'

const categoryIcons: Record<EventCategory, LucideIcon> = {
  Technology: Cpu,
  Cultural: Palette,
  Sports: Trophy,
  Workshops: Wrench,
  Hackathons: Code2,
}

interface EventCardProps {
  event: CampusEvent
  showRegistrationControl?: boolean
  registrationControl?: ReactNode
}

export function EventCard({
  event,
  showRegistrationControl = true,
  registrationControl,
}: EventCardProps) {
  const CategoryIcon = categoryIcons[event.category]

  return (
    <article className="event-card">
      <div className={`event-art event-art--${event.artwork}`}>
        <span className="event-art-label">{event.category}</span>
        <CategoryIcon className="event-art-icon" aria-hidden="true" />
        <span className="event-art-date">
          {formatEventShortDate(event.date)}
        </span>
      </div>
      <div className="event-card-content">
        <div className="event-card-heading">
          <h3>{event.title}</h3>
          {event.status === 'CANCELLED' && <span className="event-status event-status--cancelled">Cancelled</span>}
        </div>
        <p className="event-description">{event.description}</p>
        <div className="event-card-meta">
          <span>
            <span className="sr-only">Date: </span>
            {formatEventDate(event.date)}
          </span>
          <span className="event-venue">
            <span className="sr-only">Venue: </span>
            {event.venue}
          </span>
          <span className="event-ticket-price" aria-label={`Ticket price: ${formatTicketPrice(event.ticketPricePaise ?? null)}`}>
            {formatTicketPrice(event.ticketPricePaise)}
          </span>
          {event.capacity != null && event.status !== 'CANCELLED' && (
            <span className="event-seat-availability" role="status">
              {formatRemainingSeats(event.remainingSeats)}
            </span>
          )}
          {event.organizerName && (
            <span className="event-organizer" title={`Organizer: ${event.organizerName}`}>
              By {event.organizerName}
            </span>
          )}
        </div>
        <Link className="event-detail-link" to={`/events/${encodeURIComponent(event.id)}`}>
          View details <span aria-hidden="true">→</span>
        </Link>
        {event.status === 'CANCELLED' ? (
          <p className="event-cancelled-notice" role="status">This event was cancelled. Registration is closed.</p>
        ) : registrationControl ? (
          <div className="event-registration-control">{registrationControl}</div>
        ) : showRegistrationControl ? (
          <EventRegistrationControl
            eventId={event.id}
            eventTitle={event.title}
            ticketPricePaise={event.ticketPricePaise ?? null}
          />
        ) : null}
      </div>
    </article>
  )
}
