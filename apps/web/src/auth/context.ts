import { createContext } from 'react'
import type { AuthUser } from '../lib/api'

export interface AuthContextValue {
  user: AuthUser | null
  isChecking: boolean
  initializationError: string | null
  refreshUser: () => Promise<AuthUser>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
