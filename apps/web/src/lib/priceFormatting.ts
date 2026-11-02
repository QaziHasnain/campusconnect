export function formatTicketPrice(ticketPricePaise: number | null | undefined) {
  if (ticketPricePaise == null || ticketPricePaise === 0) return 'FREE'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(ticketPricePaise / 100)
}
