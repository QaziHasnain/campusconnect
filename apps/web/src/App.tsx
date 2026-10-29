import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  CalendarDays,
  MapPin,
  Search,
  Sparkles,
} from 'lucide-react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/useAuth'
import { LoginPage, RegistrationPage } from './auth/AuthPages'
import { CategoryFilter } from './components/CategoryFilter'
import { EventCard } from './components/EventCard'
import { UpcomingEventRow } from './components/UpcomingEventRow'
import { ApiError, apiRequest, eventListResponseSchema, getHealth } from './lib/api'
import { formatEventDateTime } from './lib/eventFormatting'
import { toApiCategory, toCampusEvent } from './lib/events'
import type { CampusEvent } from './types/event'
import type { EventCategory } from './types/event'
import './App.css'

function LandingPage() {
  const { user, initializationError, logout } = useAuth()
  const [events, setEvents] = useState<CampusEvent[]>([])
  const [isLoadingEvents, setIsLoadingEvents] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [retryEvents, setRetryEvents] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<EventCategory | 'All'>('All')
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    let cancelled = false
    const query = new URLSearchParams()
    if (selectedCategory !== 'All') query.set('category', toApiCategory(selectedCategory))
    if (debouncedSearch) query.set('search', debouncedSearch)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''

    void apiRequest(`/api/events${suffix}`, eventListResponseSchema)
      .then(({ events: apiEvents }) => {
        if (!cancelled) {
          setEvents(apiEvents.map(toCampusEvent))
          setEventsError(null)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setEvents([])
        setEventsError(
          error instanceof ApiError && error.status >= 500
            ? 'The events service is temporarily unavailable.'
            : 'We could not load events. Check your connection and try again.',
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoadingEvents(false)
      })

    return () => {
      cancelled = true
    }
  }, [debouncedSearch, retryEvents, selectedCategory])

  useEffect(() => {
    if (!import.meta.env.DEV) return

    let cancelled = false
    void getHealth()
      .then(() => {
        if (cancelled) return
        console.info('CampusConnect API connectivity check passed')
      })
      .catch(() => {
        if (!cancelled) {
          console.warn(
            'CampusConnect API health check failed. Check that the backend is running and VITE_API_URL is configured.',
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const featuredEvents = events.slice(0, 5)
  const upcomingEvents = events.slice(5)
  const spotlightEvent = events[0]

  function exploreEvents() {
    document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' })
  }

  function handleSearchChange(value: string) {
    if (value.trim() !== debouncedSearch) {
      setIsLoadingEvents(true)
      setEventsError(null)
    } else {
      setIsLoadingEvents(false)
    }
    setSearchQuery(value)
  }

  function handleCategoryChange(category: EventCategory | 'All') {
    if (category === selectedCategory) return
    setSelectedCategory(category)
    setIsLoadingEvents(true)
    setEventsError(null)
  }

  function retryEventLoad() {
    setIsLoadingEvents(true)
    setEventsError(null)
    setRetryEvents((attempt) => attempt + 1)
  }

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
        <a className="brand" href="#top" aria-label="CampusConnect home">
          <span className="brand-mark">
            <CalendarDays size={20} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <span>campus<span className="brand-accent">connect</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#events">Events</a>
          <a href="#about">About</a>
          {user ? (
            <span className="signed-in-label">
              Hi, {user.name} · {user.role === 'ORGANIZER' ? 'Organizer' : 'Student'}
            </span>
          ) : (
            <Link to="/login">Login</Link>
          )}
        </nav>
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
          <Link className="button button-primary header-cta" to="/register">
            Get Started <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </header>

      <main>
        {initializationError && (
          <p className="session-notice" role="alert">{initializationError}</p>
        )}
        {logoutError && (
          <p className="session-notice" role="alert">{logoutError}</p>
        )}
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="hero-copy">
            <span className="eyebrow">
              <Sparkles size={14} aria-hidden="true" />
              YOUR CAMPUS, IN SYNC
            </span>
            <h1 id="hero-title">
              Your Campus.
              <br />
              Your Events.
              <br />
              <span>One Place.</span>
            </h1>
            <p className="hero-description">
              Find your people, try something new, and make the most of every
              moment on campus. It all starts here.
            </p>
            <form
              className="hero-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                exploreEvents()
              }}
            >
              <Search size={19} aria-hidden="true" />
              <label className="sr-only" htmlFor="hero-event-search">
                Search events by name, description, or venue
              </label>
              <input
                id="hero-event-search"
                type="search"
                placeholder="Try “design”, “sports” or a venue"
                maxLength={200}
                value={searchQuery}
                onChange={(event) => handleSearchChange(event.target.value)}
              />
              <button className="button button-primary search-button" type="submit">
                Explore Events
              </button>
            </form>
            <div className="hero-proof">
              <div className="avatar-stack" aria-hidden="true">
                <span>J</span>
                <span>M</span>
                <span>A</span>
                <span>+</span>
              </div>
              <p><strong>Good things happen together.</strong> Find your next thing.</p>
            </div>
          </div>

          <div className="hero-visual" aria-label="Featured campus event preview">
            <div className="visual-glow" />
            <div className="visual-orbit visual-orbit-one" />
            <div className="visual-orbit visual-orbit-two" />
            <div className="visual-note visual-note-top">
              <span className="note-icon"><Sparkles size={15} aria-hidden="true" /></span>
              <span><strong>Make it a moment</strong><small>There’s something for everyone</small></span>
            </div>
            <article className="spotlight-card">
              <div className="spotlight-art">
                <span className="spotlight-tag">
                  {spotlightEvent ? 'UP NEXT ON CAMPUS' : 'CAMPUS EVENTS'}
                </span>
                <div className="spotlight-sun" />
                <div className="spotlight-orb spotlight-orb-one" />
                <div className="spotlight-orb spotlight-orb-two" />
                <span className="spotlight-art-caption">
                  {spotlightEvent ? 'Ideas take shape here.' : 'Find your next campus moment.'}
                </span>
              </div>
              <div className="spotlight-info">
                <div className="spotlight-date">
                  <CalendarDays size={15} aria-hidden="true" />
                  {spotlightEvent
                    ? formatEventDateTime(spotlightEvent.date)
                    : 'NEW EVENTS COMING SOON'}
                </div>
                <h2>{spotlightEvent?.title ?? 'Discover campus events'}</h2>
                <span className="spotlight-venue">
                  <MapPin size={14} aria-hidden="true" />
                  {spotlightEvent?.venue ?? 'Find something happening near you'}
                </span>
                <div className="spotlight-bottom">
                  <span className="spotlight-category">
                    {spotlightEvent?.category ?? 'Explore'}
                  </span>
                  {spotlightEvent && (
                    <span className="spotlight-organizer">{spotlightEvent.organizerName}</span>
                  )}
                </div>
              </div>
            </article>
            <div className="visual-note visual-note-bottom">
              <span className="live-dot" />
              <span><strong>Campus is coming alive</strong><small>Find your next favorite thing</small></span>
              <ArrowDown size={16} aria-hidden="true" />
            </div>
          </div>
          <a className="hero-scroll" href="#events" aria-label="Scroll to events">
            SCROLL TO EXPLORE <ArrowDown size={14} aria-hidden="true" />
          </a>
        </section>

        <section
          className="events-section section-wrap"
          id="events"
          aria-labelledby="events-title"
          aria-busy={isLoadingEvents}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow section-eyebrow">GOOD THINGS ARE HAPPENING</span>
              <h2 id="events-title">Find your next campus moment.</h2>
              <p>Big ideas, new friends, and memories you didn’t plan on making.</p>
            </div>
            <div className="section-count" aria-live="polite">
              <strong>
                {isLoadingEvents ? '—' : events.length.toString().padStart(2, '0')}
              </strong>
              <span>events<br />to explore</span>
            </div>
          </div>

          <div className="event-controls">
            <CategoryFilter
              selectedCategory={selectedCategory}
              onSelectCategory={handleCategoryChange}
            />
            <label className="section-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search events by name, description, or venue</span>
              <input
                type="search"
                placeholder="Search events..."
                maxLength={200}
                value={searchQuery}
                onChange={(event) => handleSearchChange(event.target.value)}
              />
            </label>
          </div>

          {isLoadingEvents ? (
            <div className="empty-state" role="status" aria-live="polite">
              <p>Loading campus events…</p>
            </div>
          ) : eventsError ? (
            <div className="empty-state" role="alert">
              <h3>Events unavailable</h3>
              <p>{eventsError}</p>
              <button
                className="text-button"
                type="button"
                onClick={retryEventLoad}
              >
                Try again <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              {featuredEvents.length > 0 && (
                <div className="featured-grid">
                  {featuredEvents.map((event) => (
                    <EventCard event={event} key={event.id} />
                  ))}
                </div>
              )}

              {events.length === 0 && (
                <div className="empty-state" role="status">
                  <Search size={23} aria-hidden="true" />
                  <h3>No events found just yet.</h3>
                  <p>Try another search or choose a different category.</p>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      handleSearchChange('')
                      handleCategoryChange('All')
                    }}
                  >
                    Clear filters <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {upcomingEvents.length > 0 && (
          <section className="upcoming-section" aria-labelledby="upcoming-title">
            <div className="section-wrap">
              <div className="upcoming-heading">
                <div>
                  <span className="eyebrow section-eyebrow">SAVE THE DATE</span>
                  <h2 id="upcoming-title">Coming up on campus.</h2>
                </div>
                <a className="text-button" href="#events">
                  See all events <ArrowRight size={16} aria-hidden="true" />
                </a>
              </div>
              <div className="upcoming-list">
                {upcomingEvents.map((event, index) => (
                  <UpcomingEventRow event={event} index={index} key={event.id} />
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="community-section section-wrap" id="about" aria-labelledby="community-title">
          <div className="community-mark" aria-hidden="true">
            <CalendarDays size={29} strokeWidth={1.7} />
          </div>
          <div>
            <span className="eyebrow section-eyebrow">CAMPUS LIFE, CONNECTED</span>
            <h2 id="community-title">Your next story starts here.</h2>
            <p>One campus, a hundred ways to show up. Find the ones that feel like you.</p>
          </div>
          <a className="button button-primary" href="#events">
            Find your event <ArrowRight size={16} aria-hidden="true" />
          </a>
        </section>
      </main>

      <footer className="site-footer" id="footer">
        <div className="footer-main">
          <a className="brand footer-brand" href="#top">
            <span className="brand-mark">
              <CalendarDays size={19} strokeWidth={2.2} aria-hidden="true" />
            </span>
            <span>campus<span className="brand-accent">connect</span></span>
          </a>
          <p>Campus life, brought a little closer.</p>
          <nav className="footer-links" aria-label="Footer navigation">
            <a href="#events">Explore events</a>
            <a href="#about">About us</a>
            {user ? (
              <button
                className="footer-logout"
                type="button"
                onClick={() => void handleLogout()}
                disabled={isLoggingOut}
              >
                Log out
              </button>
            ) : (
              <Link to="/login">Login</Link>
            )}
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© 2026 CampusConnect. Made for campus life.</span>
          <span>Find your community on campus.</span>
        </div>
      </footer>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegistrationPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
