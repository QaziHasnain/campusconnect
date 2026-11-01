import { useEffect } from 'react'
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { divIcon } from 'leaflet'
import type { LatLngTuple } from 'leaflet'
import type { VenueCoordinates } from '../lib/venueMapUtils'
import 'leaflet/dist/leaflet.css'
import './VenueMap.css'

const defaultCenter: LatLngTuple = [20, 0]
const markerIcon = divIcon({
  className: 'venue-map-marker',
  html: '<span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})
const tileUrl =
  import.meta.env.VITE_MAP_TILE_URL ||
  'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const tileAttribution =
  import.meta.env.VITE_MAP_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'

function MapClickSelector({
  onSelect,
}: {
  onSelect?: (coordinates: VenueCoordinates) => void
}) {
  useMapEvents({
    click(event) {
      if (!onSelect) return
      onSelect({
        latitude: Number(event.latlng.lat.toFixed(6)),
        longitude: Number(event.latlng.lng.toFixed(6)),
      })
    },
  })
  return null
}

function KeepVenueCentered({ position }: { position: VenueCoordinates | null }) {
  const map = useMap()

  useEffect(() => {
    if (position) map.setView([position.latitude, position.longitude], Math.max(map.getZoom(), 13))
  }, [map, position])

  return null
}

export function VenueMap({
  position,
  onSelect,
  className = '',
  ariaLabel,
}: {
  position: VenueCoordinates | null
  onSelect?: (coordinates: VenueCoordinates) => void
  className?: string
  ariaLabel: string
}) {
  const center: LatLngTuple = position
    ? [position.latitude, position.longitude]
    : defaultCenter

  return (
    <div className={`venue-map-shell ${className}`}>
      <MapContainer
        className="venue-map"
        center={center}
        zoom={position ? 14 : 2}
        scrollWheelZoom={false}
        aria-label={ariaLabel}
      >
        <TileLayer url={tileUrl} attribution={tileAttribution} />
        <KeepVenueCentered position={position} />
        <MapClickSelector onSelect={onSelect} />
        {position && (
          <Marker
            position={[position.latitude, position.longitude]}
            icon={markerIcon}
          >
            <Popup>Selected venue</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}
