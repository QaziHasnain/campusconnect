import type { ApiEvent, ApiEventCategory } from './api'
import type { CampusEvent, EventArtwork, EventCategory } from '../types/event'

const categoryLabels: Record<ApiEventCategory, EventCategory> = {
  TECHNOLOGY: 'Technology',
  CULTURAL: 'Cultural',
  SPORTS: 'Sports',
  WORKSHOPS: 'Workshops',
  HACKATHONS: 'Hackathons',
}

const categoryArtwork: Record<EventCategory, EventArtwork> = {
  Technology: 'technology',
  Cultural: 'cultural',
  Sports: 'sports',
  Workshops: 'workshops',
  Hackathons: 'hackathons',
}

const apiCategories: Record<EventCategory, ApiEventCategory> = {
  Technology: 'TECHNOLOGY',
  Cultural: 'CULTURAL',
  Sports: 'SPORTS',
  Workshops: 'WORKSHOPS',
  Hackathons: 'HACKATHONS',
}

export function toCampusEvent(event: ApiEvent): CampusEvent {
  const category = categoryLabels[event.category]

  return {
    id: event.id,
    status: event.status,
    title: event.title,
    date: event.startAt,
    venue: event.venue,
    ticketPricePaise: event.ticketPricePaise,
    capacity: event.capacity,
    registeredCount: event.registeredCount,
    remainingSeats: event.remainingSeats,
    category,
    description: event.description,
    artwork: categoryArtwork[category],
    organizerName: event.organizer.name,
  }
}

export function toApiCategory(category: EventCategory): ApiEventCategory {
  return apiCategories[category]
}
