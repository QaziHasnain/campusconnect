import { ArrowUpRight, MapPin } from 'lucide-react'
import type { CampusEvent } from '../types/event'

interface UpcomingEventRowProps {
  event: CampusEvent
  index: number
}

export function UpcomingEventRow({ event, index }: UpcomingEventRowProps) {
  const eventDate = new Date(`${event.date}T12:00:00`)

  return (
    <article className="upcoming-row">
      <span className="upcoming-number">{String(index + 1).padStart(2, '0')}</span>
      <div className="upcoming-date">
        <span>
          {eventDate.toLocaleDateString('en-US', { month: 'short' })}
        </span>
        <strong>{eventDate.toLocaleDateString('en-US', { day: '2-digit' })}</strong>
      </div>
      <div className="upcoming-details">
        <span className="upcoming-category">{event.category}</span>
        <h3>{event.title}</h3>
        <p>{event.description}</p>
      </div>
      <span className="upcoming-venue">
        <MapPin size={16} aria-hidden="true" />
        {event.venue}
      </span>
      <span className="upcoming-price">{event.price === 0 ? 'Free' : `$${event.price}`}</span>
      <ArrowUpRight className="upcoming-arrow" size={19} aria-hidden="true" />
    </article>
  )
}
