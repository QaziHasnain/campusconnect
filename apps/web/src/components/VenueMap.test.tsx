// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VenueMap } from './VenueMap'
import {
  getDirectionsUrl,
  isValidVenueCoordinates,
} from '../lib/venueMapUtils'
import { cleanup } from '@testing-library/react'

const mapState = vi.hoisted(() => ({
  click: null as null | ((event: { latlng: { lat: number; lng: number } }) => void),
}))

const stanfordCoordinates = { latitude: 37.42902, longitude: -122.16645 }

vi.mock('leaflet', () => ({ divIcon: () => ({}) }))

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: ({
      children,
      center,
      zoom,
      className,
      ...attributes
    }: {
      children: React.ReactNode
      center: [number, number]
      zoom: number
      className: string
      [key: string]: unknown
    }) =>
      React.createElement(
        'div',
        {
          ...attributes,
          className,
          'data-testid': 'venue-map-container',
          'data-center': center.join(','),
          'data-zoom': zoom,
          onClick: () =>
            mapState.click?.({
              latlng: {
                lat: stanfordCoordinates.latitude,
                lng: stanfordCoordinates.longitude,
              },
            }),
        },
        children,
      ),
    Marker: ({
      children,
      position,
    }: {
      children: React.ReactNode
      position: [number, number]
    }) =>
      React.createElement(
        'div',
        {
          'data-testid': 'venue-map-marker',
          'data-position': position.join(','),
        },
        children,
      ),
    Popup: ({ children }: { children: React.ReactNode }) =>
      React.createElement('span', null, children),
    TileLayer: ({ url, attribution }: { url: string; attribution: string }) =>
      React.createElement('div', {
        'data-testid': 'venue-map-tiles',
        'data-url': url,
        'data-attribution': attribution,
      }),
    useMap: () => ({ getZoom: () => 2, setView: vi.fn() }),
    useMapEvents: (handlers: { click: (event: { latlng: { lat: number; lng: number } }) => void }) => {
      mapState.click = handlers.click
    },
  }
})

describe('venue map helpers and component', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    mapState.click = null
  })

  it('accepts valid coordinate boundaries and rejects out-of-range or incomplete positions', () => {
    expect(isValidVenueCoordinates(-90, -180)).toBe(true)
    expect(isValidVenueCoordinates(90, 180)).toBe(true)
    expect(isValidVenueCoordinates(90.01, 0)).toBe(false)
    expect(isValidVenueCoordinates(0, -180.01)).toBe(false)
    expect(isValidVenueCoordinates(12, null)).toBe(false)
    expect(isValidVenueCoordinates(null, null)).toBe(true)
  })

  it('does not place a marker or imply a venue when coordinates are absent', () => {
    render(
      <VenueMap
        position={null}
        ariaLabel="Select venue"
      />,
    )

    expect(screen.queryByTestId('venue-map-marker')).toBeNull()
    expect(screen.getByTestId('venue-map-container').getAttribute('data-center')).toBe('20,0')
    expect(screen.getByTestId('venue-map-container').getAttribute('data-zoom')).toBe('2')
    expect(screen.getByTestId('venue-map-tiles').getAttribute('data-url'))
      .toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(screen.getByTestId('venue-map-tiles').getAttribute('data-attribution'))
      .toContain('OpenStreetMap')
  })

  it('renders Stanford Memorial Auditorium and lets organizers choose its position', () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <VenueMap
        position={stanfordCoordinates}
        onSelect={onSelect}
        ariaLabel="Select venue"
      />,
    )
    expect(screen.getByTestId('venue-map-marker').getAttribute('data-position'))
      .toBe('37.42902,-122.16645')
    expect(screen.getByTestId('venue-map-container').getAttribute('aria-label')).toBe('Select venue')

    fireEvent.click(screen.getByTestId('venue-map-container'))
    expect(onSelect).toHaveBeenCalledWith({
      latitude: stanfordCoordinates.latitude,
      longitude: stanfordCoordinates.longitude,
    })

    rerender(
      <VenueMap
        position={stanfordCoordinates}
        onSelect={onSelect}
        ariaLabel="Select venue"
      />,
    )
    expect(screen.getByTestId('venue-map-marker').getAttribute('data-position'))
      .toBe('37.42902,-122.16645')
  })

  it('creates directions links from coordinates or a venue address', () => {
    expect(getDirectionsUrl({ latitude: 12.5, longitude: 77.6 }, 'Campus Hall'))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=12.5%2C77.6')
    expect(getDirectionsUrl(null, 'Campus Hall, Bengaluru'))
      .toBe('https://www.google.com/maps/dir/?api=1&destination=Campus%20Hall%2C%20Bengaluru')
    expect(getDirectionsUrl(null, null)).toBeNull()
  })
})
