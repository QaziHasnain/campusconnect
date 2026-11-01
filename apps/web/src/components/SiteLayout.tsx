import { useEffect, useState } from 'react'
import {
  ArrowRight,
  CalendarDays,
  Menu,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ApiError } from '../lib/api'

export function SiteLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  useEffect(() => {
    if (location.pathname === '/' && location.hash) {
      window.setTimeout(() => {
        document.getElementById(location.hash.slice(1))?.scrollIntoView()
      }, 0)
    }
  }, [location.pathname, location.hash])

  async function handleLogout() {
    setLogoutError(null)
    setIsLoggingOut(true)
    try {
      await logout()
    } catch (error) {
      setLogoutError(
        error instanceof ApiError && error.status >= 500
          ? 'The service is temporarily unavailable. Please try again.'
          : 'Unable to sign out. Please check your connection and try again.',
      )
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <div className="site-shell" id="top">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="CampusConnect home">
          <span className="brand-mark">
            <CalendarDays size={20} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span>campus<span className="brand-accent">connect</span></span>
        </Link>

        <button
          className="mobile-menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
        </button>

        <nav
          className={`main-nav${menuOpen ? ' is-open' : ''}`}
          id="primary-navigation"
          aria-label="Main navigation"
          onClick={() => setMenuOpen(false)}
        >
          <Link
            to="/"
            className={location.pathname === '/' && !location.hash ? 'active-nav-link' : undefined}
            aria-current={location.pathname === '/' && !location.hash ? 'page' : undefined}
          >
            Home
          </Link>
          <Link
            to="/#events"
            className={
              location.pathname === '/' && location.hash === '#events'
                ? 'active-nav-link'
                : undefined
            }
            aria-current={location.pathname === '/' && location.hash === '#events' ? 'page' : undefined}
          >
            Discover Events
          </Link>
          <NavLink to="/about">About</NavLink>
          <NavLink to="/how-it-works">How It Works</NavLink>
          <NavLink to="/faq">FAQ</NavLink>
          {user?.role === 'ORGANIZER' && <NavLink to="/organizer">Organizer Dashboard</NavLink>}
          {user?.role === 'STUDENT' && <NavLink to="/registrations">My Registrations</NavLink>}
          {user && (
            <span className="signed-in-label">
              Hi, {user.name} · {user.role === 'ORGANIZER' ? 'Organizer' : 'Student'}
            </span>
          )}
        </nav>

        <div className="header-account-actions">
          {user ? (
            <button
              className="button button-primary header-cta"
              type="button"
              onClick={() => void handleLogout()}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? 'Signing out…' : 'Log out'}
            </button>
          ) : (
            <>
              <Link className="header-login-link" to="/login">Log in</Link>
              <Link className="button button-primary header-cta" to="/register">
                Get Started <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </>
          )}
        </div>
      </header>

      {logoutError && <p className="session-notice" role="alert">{logoutError}</p>}
      {children}

      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand-block">
            <Link className="brand footer-brand" to="/">
              <span className="brand-mark">
                <CalendarDays size={19} strokeWidth={2.2} aria-hidden="true" />
              </span>
              <span>campus<span className="brand-accent">connect</span></span>
            </Link>
            <p>Campus life, brought a little closer.</p>
          </div>
          <nav className="footer-links" aria-label="Footer navigation">
            <Link to="/#events">Discover Events</Link>
            <Link to="/about">About</Link>
            <Link to="/how-it-works">How It Works</Link>
            <Link to="/faq">FAQ</Link>
            {user?.role === 'ORGANIZER' && <Link to="/organizer">Organizer Dashboard</Link>}
            {user?.role === 'STUDENT' && <Link to="/registrations">My Registrations</Link>}
            {!user && <Link to="/login">Log in</Link>}
            {!user && <Link to="/register">Create account</Link>}
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© 2026 CampusConnect. Made for campus life.</span>
          <Link to="/#events">Find your community on campus</Link>
        </div>
      </footer>
    </div>
  )
}
