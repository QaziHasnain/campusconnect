// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { EventDetailsPage } from './PublicPages'

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: null, isChecking: false }),
}))

vi.mock('leaflet', () => ({ divIcon: () => ({}) }))

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: ({
      children,
      center,
      ...attributes
    }: {
      children: React.ReactNode
      center: [number, number]
      [key: string]: unknown
    }) =>
      React.createElement(
        'div',
        {
          ...attributes,
          'data-testid': 'venue-map-container',
          'data-center': center.join(','),
        },
        children,
      ),
    Marker: ({ position }: { position: [number, number] }) =>
      React.createElement('div', {
        'data-testid': 'venue-map-marker',
        'data-position': position.join(','),
      }),
    Popup: ({ children }: { children: React.ReactNode }) =>
      React.createElement('span', null, children),
    TileLayer: () => React.createElement('div', { 'data-testid': 'venue-map-tiles' }),
    useMap: () => ({ getZoom: () => 14, setView: vi.fn() }),
    useMapEvents: () => undefined,
  }
})

const event = {
  id: 'event-map',
  title: 'Stanford Memorial Auditorium Event',
  description: 'Meet the campus community.',
  category: 'CULTURAL',
  venue: 'Stanford Memorial Auditorium',
  venueAddress: '551 Jane Stanford Way, Stanford, CA 94305, USA',
  latitude: 37.42902 as number | null,
  longitude: -122.16645 as number | null,
  ticketPricePaise: null,
  startAt: '2026-11-21T10:00:00.000Z',
  endAt: null,
  status: 'PUBLISHED',
  capacity: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  organizer: { name: 'Campus Team' },
}

function renderEventDetails(eventData: typeof event) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ event: eventData }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )

  return render(
    <MemoryRouter initialEntries={['/events/event-map']}>
      <Routes>
        <Route path="/events/:eventId" element={<EventDetailsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('public event venue display', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the address, accurate map marker, and coordinate directions when coordinates exist', async () => {
    renderEventDetails(event)

    expect(await screen.findByText('551 Jane Stanford Way, Stanford, CA 94305, USA')).toBeTruthy()
    expect((await screen.findByTestId('venue-map-marker')).getAttribute('data-position'))
      .toBe('37.42902,-122.16645')
    expect(screen.getByTestId('venue-map-container').getAttribute('data-center'))
      .toBe('37.42902,-122.16645')
    const directions = screen.getByRole('link', { name: /Get Directions/ })
    expect(directions.getAttribute('href'))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=37.42902%2C-122.16645')
    expect(directions.getAttribute('target')).toBe('_blank')
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/events/event-map',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('does not render a map without coordinates and uses the address for directions', async () => {
    renderEventDetails({ ...event, latitude: null, longitude: null })

    expect(await screen.findByText('551 Jane Stanford Way, Stanford, CA 94305, USA')).toBeTruthy()
    expect(screen.queryByTestId('venue-map-marker')).toBeNull()
    expect(screen.getByRole('link', { name: /Get Directions/ }).getAttribute('href'))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=551%20Jane%20Stanford%20Way%2C%20Stanford%2C%20CA%2094305%2C%20USA')
  })
})
