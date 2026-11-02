export type EventCategory =
  | 'Technology'
  | 'Cultural'
  | 'Sports'
  | 'Workshops'
  | 'Hackathons'

export type EventArtwork = Lowercase<EventCategory>

export interface CampusEvent {
  id: string
  status?: 'DRAFT' | 'PUBLISHED' | 'CANCELLED'
  title: string
  date: string
  venue: string
  ticketPricePaise?: number | null
  capacity?: number | null
  registeredCount?: number
  remainingSeats?: number | null
  category: EventCategory
  price?: number
  description: string
  featured?: boolean
  artwork: EventArtwork
  organizerName?: string
}
