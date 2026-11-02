export const eventRegistrationChangedEvent = 'campusconnect:event-registration-changed'

export function notifyEventRegistrationChanged(eventId: string) {
  window.dispatchEvent(new CustomEvent(eventRegistrationChangedEvent, { detail: { eventId } }))
}

export function formatRemainingSeats(remainingSeats: number | null | undefined) {
  if (remainingSeats == null) return null
  if (remainingSeats === 0) return 'Sold out'
  if (remainingSeats <= 5) return 'Almost full'
  return `${remainingSeats} seats left`
}
