// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventRegistrationControl } from './EventRegistrationControl'

const api = vi.hoisted(() => ({
  getEventRegistrationStatus: vi.fn(),
  registerForEvent: vi.fn(),
  getPaymentConfig: vi.fn(),
  createEventPaymentOrder: vi.fn(),
  getEventPaymentStatus: vi.fn(),
  cancelEventPayment: vi.fn(),
  verifyEventPayment: vi.fn(),
}))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'student-1', role: 'STUDENT', name: 'Student', email: 'student@example.test' },
    isChecking: false,
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, ...api }
})

describe('free event registration control', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('registers directly without checking Razorpay or opening checkout', async () => {
    api.getEventRegistrationStatus.mockResolvedValue({ registered: false })
    api.registerForEvent.mockResolvedValue({ registration: { id: 'registration-1' } })

    render(
      <MemoryRouter>
        <EventRegistrationControl eventId="free-event" eventTitle="Free Event" />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Register for Free Event' }))

    await waitFor(() => expect(api.registerForEvent).toHaveBeenCalledWith('free-event'))
    expect((await screen.findByRole('status')).textContent).toBe('Registered')
    expect(api.getPaymentConfig).not.toHaveBeenCalled()
    expect(api.createEventPaymentOrder).not.toHaveBeenCalled()
    expect(document.querySelector('script[src*="razorpay"]')).toBeNull()
  })
})
