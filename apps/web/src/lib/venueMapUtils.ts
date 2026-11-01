export interface VenueCoordinates {
  latitude: number
  longitude: number
}

export function isValidVenueCoordinates(
  latitude: number | null,
  longitude: number | null,
): boolean {
  if (latitude === null || longitude === null) return latitude === null && longitude === null
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  )
}

export function getDirectionsUrl(
  coordinates: VenueCoordinates | null,
  address: string | null,
) {
  const destination = coordinates
    ? `${coordinates.latitude},${coordinates.longitude}`
    : address
  if (!destination) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}
