import { ArrowUpRight, MapPin } from 'lucide-react'
import type { CampusEvent } from '../types/event'
import { formatEventDay, formatEventMonth } from '../lib/eventFormatting'

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
        <h3>{event.title}</h3>
        <p>{event.description}</p>
      </div>
      <span className="upcoming-venue">
        <MapPin size={16} aria-hidden="true" />
        {event.venue}
      </span>
      <span className="upcoming-organizer">{event.organizerName}</span>
      <ArrowUpRight className="upcoming-arrow" size={19} aria-hidden="true" />
    </article>
  )
}
