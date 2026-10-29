import { useEffect, useState, type ReactNode } from 'react'
import { ApiError, apiRequest, currentUserResponseSchema, logoutResponseSchema } from '../lib/api'
import type { AuthUser } from '../lib/api'
import { AuthContext } from './context'

async function getCurrentUser() {
  return apiRequest('/api/auth/me', currentUserResponseSchema)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const [initializationError, setInitializationError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void getCurrentUser()
      .then(({ user: currentUser }) => {
        if (cancelled) return
        setUser(currentUser)
        setInitializationError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setUser(null)
        if (error instanceof ApiError && error.status === 401) {
          setInitializationError(null)
        } else {
          setInitializationError(
            'We could not check your sign-in status. Please check your connection and try again.',
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsChecking(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function refreshUser() {
    const { user: currentUser } = await getCurrentUser()
    setUser(currentUser)
    setInitializationError(null)
    return currentUser
  }

  async function logout() {
    await apiRequest('/api/auth/logout', logoutResponseSchema, { method: 'POST' })
    setUser(null)
    setInitializationError(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, isChecking, initializationError, refreshUser, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}
