import {
  Code2,
  Cpu,
  Palette,
  Trophy,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { CampusEvent, EventCategory } from '../types/event'

const categoryIcons: Record<EventCategory, LucideIcon> = {
  Technology: Cpu,
  Cultural: Palette,
  Sports: Trophy,
  Workshops: Wrench,
  Hackathons: Code2,
}

interface EventCardProps {
  event: CampusEvent
}

export function EventCard({ event }: EventCardProps) {
  const CategoryIcon = categoryIcons[event.category]
  const eventDate = new Date(`${event.date}T12:00:00`)

  return (
    <article className="event-card">
      <div className={`event-art event-art--${event.artwork}`}>
        <span className="event-art-label">{event.category}</span>
        <CategoryIcon className="event-art-icon" aria-hidden="true" />
        <span className="event-art-date">
          {eventDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </div>
      <div className="event-card-content">
        <div className="event-card-heading">
          <h3>{event.title}</h3>
          <span className="event-price">{event.price === 0 ? 'Free' : `$${event.price}`}</span>
        </div>
        <p className="event-description">{event.description}</p>
        <div className="event-card-meta">
          <span>
            <span className="sr-only">Date: </span>
            {eventDate.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
          <span className="event-venue">
            <span className="sr-only">Venue: </span>
            {event.venue}
          </span>
        </div>
      </div>
    </article>
  )
}
