// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from './auth/context'
import { StudentRoute } from './App'

describe('protected student routes after logout', () => {
  afterEach(cleanup)

  it('redirects a stale protected-page history entry to sign-in when auth is cleared', async () => {
    render(
      <AuthContext.Provider value={{
        user: null,
        isChecking: false,
        initializationError: null,
        refreshUser: async () => { throw new Error('not signed in') },
        logout: async () => {},
      }}>
        <MemoryRouter initialEntries={['/registrations']}>
          <Routes>
            <Route path="/registrations" element={<StudentRoute><h1>Private registrations</h1></StudentRoute>} />
            <Route path="/login" element={<h1>Sign in page</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )

    expect(await screen.findByRole('heading', { name: 'Sign in page' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Private registrations' })).toBeNull()
  })
})
