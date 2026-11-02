// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SiteLayout } from './SiteLayout'

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'student-1', name: 'Sam', role: 'STUDENT' },
    logout,
  }),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, getNotifications: vi.fn().mockResolvedValue({ unreadCount: 0 }) }
})

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/private']}>
      <SiteLayout>
        <Routes>
          <Route path="/private" element={<h1>Private page</h1>} />
          <Route path="/login" element={<h1>Sign in page</h1>} />
        </Routes>
      </SiteLayout>
    </MemoryRouter>,
  )
}

describe('logout navigation', () => {
  afterEach(() => {
    cleanup()
    logout.mockReset()
  })

  it('replaces the current route with sign-in after the server logout succeeds', async () => {
    logout.mockResolvedValue(undefined)
    renderLayout()

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in page' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Private page' })).toBeNull()
  })

  it('keeps the user on the current page and reports an API failure', async () => {
    logout.mockRejectedValue(new Error('network failure'))
    renderLayout()

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Private page' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sign in page' })).toBeNull()
  })
})

describe('responsive navigation', () => {
  afterEach(() => {
    cleanup()
  })

  it('opens the navigation menu accessibly and closes it after choosing a page', () => {
    renderLayout()

    const toggle = screen.getByRole('button', { name: 'Open navigation menu' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggle)

    const closeToggle = screen.getByRole('button', { name: 'Close navigation menu' })
    expect(closeToggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('navigation', { name: 'Main navigation' }).className).toContain('is-open')

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'About' }))

    expect(screen.getByRole('button', { name: 'Open navigation menu' }).getAttribute('aria-expanded')).toBe('false')
  })
})
