# Venue maps setup

CampusConnect uses Leaflet, React-Leaflet, and OpenStreetMap raster tiles. Organizers can enter a
venue name and address, select a position on the map, or enter latitude/longitude directly. Students
see the address, an interactive map marker when coordinates are available, and a Google Maps
directions link. Existing events without coordinates remain valid and do not show a fabricated
venue marker.

## Local configuration

The map uses OpenStreetMap's HTTPS tile endpoint and attribution by default. To use a compatible
tile provider later, set these frontend build-time variables in `apps/web/.env`:

```dotenv
VITE_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
VITE_MAP_ATTRIBUTION=&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>
```

Keep the attribution required by the selected provider visible. These settings are public frontend
configuration, not credentials. The initial implementation does not geocode addresses; organizers
must choose coordinates on the map or enter them.

## OpenStreetMap usage

- The map displays visible OpenStreetMap attribution.
- Tiles are requested from `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- CampusConnect does not bulk-download, prefetch, or implement a tile cache.
- The public OpenStreetMap tile service is best-effort, may be rate-limited, and does not provide a
  production service-level agreement. Select an appropriate provider before production traffic.
- Do not use the public tile service for offline downloads or high-volume production usage.

