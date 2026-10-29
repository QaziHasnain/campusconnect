const dateOptions: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}

function parseEventDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatEventDate(value: string): string {
  const date = parseEventDate(value)
  return date ? new Intl.DateTimeFormat('en-US', dateOptions).format(date) : 'Date unavailable'
}

export function formatEventShortDate(value: string): string {
  const date = parseEventDate(value)
  return date
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
      }).format(date)
    : 'Date unavailable'
}

export function formatEventMonth(value: string): string {
  const date = parseEventDate(value)
  return date
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(date)
    : '—'
}

export function formatEventDay(value: string): string {
  const date = parseEventDate(value)
  return date
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: '2-digit' }).format(date)
    : '—'
}

export function formatEventDateTime(value: string): string {
  const date = parseEventDate(value)
  return date
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'short',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
      })
        .format(date)
        .toUpperCase()
    : 'DATE TO BE ANNOUNCED'
}
