// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { getOrganizerEventAttendees } from '../lib/api'
import { OrganizerAttendeesPage } from './OrganizerAttendeesPage'

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, getOrganizerEventAttendees: vi.fn() }
})

const getAttendees = vi.mocked(getOrganizerEventAttendees)

describe('organizer attendee list', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('shows registration totals and filters by attendee and payment type', async () => {
    getAttendees.mockResolvedValue({
      event: { id: 'owned-event', title: 'Campus Summit', status: 'PUBLISHED', capacity: 20 },
      totalRegistrations: 2,
      availableCapacity: 18,
      attendees: [
        {
          name: 'Ada Lovelace',
          email: 'ada@example.test',
          registeredAt: '2026-11-01T10:00:00.000Z',
          registrationStatus: 'CONFIRMED',
          paymentStatus: 'FREE',
        },
        {
          name: 'Grace Hopper',
          email: 'grace@example.test',
          registeredAt: '2026-11-02T10:00:00.000Z',
          registrationStatus: 'CONFIRMED',
          paymentStatus: 'SUCCESSFUL',
        },
      ],
    })

    render(
      <MemoryRouter initialEntries={['/organizer/events/owned-event/attendees']}>
        <Routes>
          <Route path="/organizer/events/:eventId/attendees" element={<OrganizerAttendeesPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Attendees' })).toBeTruthy()
    expect(screen.getByText('Campus Summit')).toBeTruthy()
    expect(screen.getByText('18')).toBeTruthy()
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
    expect(screen.getByText('Grace Hopper')).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search attendees' }), {
      target: { value: 'Grace' },
    })
    expect(screen.getByText('Grace Hopper')).toBeTruthy()
    expect(screen.queryByText('Ada Lovelace')).toBeNull()

    fireEvent.change(screen.getByLabelText('Payment'), { target: { value: 'FREE' } })
    expect(screen.getByText('No matching attendees')).toBeTruthy()
  })
})
