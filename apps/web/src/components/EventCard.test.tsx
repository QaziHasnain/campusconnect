// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { EventCard } from './EventCard'
import type { CampusEvent } from '../types/event'
import { toCampusEvent } from '../lib/events'

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: null, isChecking: false }),
}))

const event: CampusEvent = {
  id: 'event-price',
  title: 'Campus Workshop',
  date: '2026-11-21T10:00:00.000Z',
  venue: 'Main Hall',
  category: 'Workshops',
  description: 'Learn something new.',
  artwork: 'workshops',
  ticketPricePaise: null,
}

function renderCard(ticketPricePaise: number | null) {
  return render(
    <MemoryRouter>
      <EventCard event={{ ...event, ticketPricePaise }} showRegistrationControl={false} />
    </MemoryRouter>,
  )
}

describe('event card ticket prices', () => {
  afterEach(cleanup)

  it('shows FREE for a free event', () => {
    renderCard(null)
    expect(screen.getByText('FREE')).toBeTruthy()
  })

  it('shows the configured INR price for a paid event', () => {
    const mappedEvent = toCampusEvent({
      id: event.id,
      title: event.title,
      description: event.description,
      category: 'WORKSHOPS',
      venue: event.venue,
      venueAddress: null,
      latitude: null,
      longitude: null,
      ticketPricePaise: 49900,
      startAt: event.date,
      endAt: null,
      status: 'PUBLISHED',
      capacity: null,
      registeredCount: 0,
      remainingSeats: null,
      createdAt: event.date,
      updatedAt: event.date,
      organizer: { name: 'Campus Team' },
    })
    render(
      <MemoryRouter>
        <EventCard event={mappedEvent} showRegistrationControl={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText('₹499')).toBeTruthy()
  })
  it('shows cancelled status and hides registration controls', () => {
    render(
      <MemoryRouter>
        <EventCard event={{ ...event, status: 'CANCELLED' }} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Cancelled')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Registration is closed')
    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull()
  })

  it('shows the remaining seat count and sold-out status', () => {
    render(
      <MemoryRouter>
        <EventCard event={{ ...event, capacity: 120, registeredCount: 110, remainingSeats: 10 }} showRegistrationControl={false} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status').textContent).toBe('10 seats left')

    cleanup()
    render(
      <MemoryRouter>
        <EventCard event={{ ...event, capacity: 120, registeredCount: 115, remainingSeats: 5 }} showRegistrationControl={false} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status').textContent).toBe('Almost full')

    cleanup()
    render(
      <MemoryRouter>
        <EventCard event={{ ...event, capacity: 120, registeredCount: 120, remainingSeats: 0 }} showRegistrationControl={false} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('status').textContent).toBe('Sold out')
  })
})
