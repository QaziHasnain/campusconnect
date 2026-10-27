import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  CalendarDays,
  MapPin,
  Search,
  Sparkles,
} from 'lucide-react'
import { CategoryFilter } from './components/CategoryFilter'
import { EventCard } from './components/EventCard'
import { UpcomingEventRow } from './components/UpcomingEventRow'
import { events } from './data/events'
import type { EventCategory } from './types/event'
import './App.css'

function App() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<EventCategory | 'All'>('All')

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()

    return events.filter((event) => {
      const matchesCategory =
        selectedCategory === 'All' || event.category === selectedCategory
      const matchesSearch =
        query.length === 0 ||
        `${event.title} ${event.category} ${event.venue}`
          .toLocaleLowerCase()
          .includes(query)

      return matchesCategory && matchesSearch
    })
  }, [searchQuery, selectedCategory])

  const featuredEvents = filteredEvents.filter((event) => event.featured)
  const upcomingEvents = filteredEvents
    .filter((event) => !event.featured)
    .sort((first, second) => first.date.localeCompare(second.date))

  function exploreEvents() {
    document.getElementById('events')?.scrollIntoView({ behavior: 'smooth' })
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
          <a href="#login">Login</a>
        </nav>
        <a className="button button-primary header-cta" href="#events">
          Get Started <ArrowRight size={16} aria-hidden="true" />
        </a>
      </header>

      <main>
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
                Search events by name, category, or venue
              </label>
              <input
                id="hero-event-search"
                type="search"
                placeholder="Try “design”, “sports” or a venue"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
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
                <span className="spotlight-tag">UP NEXT ON CAMPUS</span>
                <div className="spotlight-sun" />
                <div className="spotlight-orb spotlight-orb-one" />
                <div className="spotlight-orb spotlight-orb-two" />
                <span className="spotlight-art-caption">Ideas take shape here.</span>
              </div>
              <div className="spotlight-info">
                <div className="spotlight-date">
                  <CalendarDays size={15} aria-hidden="true" />
                  SAT, NOV 07 · 10:00 AM
                </div>
                <h2>Campus AI Summit</h2>
                <span className="spotlight-venue">
                  <MapPin size={14} aria-hidden="true" />
                  Innovation Hall
                </span>
                <div className="spotlight-bottom">
                  <span className="spotlight-category">Technology</span>
                  <span className="spotlight-price">$12 <small>/ ticket</small></span>
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

        <section className="events-section section-wrap" id="events" aria-labelledby="events-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow section-eyebrow">GOOD THINGS ARE HAPPENING</span>
              <h2 id="events-title">Find your next campus moment.</h2>
              <p>Big ideas, new friends, and memories you didn’t plan on making.</p>
            </div>
            <div className="section-count" aria-live="polite">
              <strong>{filteredEvents.length.toString().padStart(2, '0')}</strong>
              <span>events<br />to explore</span>
            </div>
          </div>

          <div className="event-controls">
            <CategoryFilter
              selectedCategory={selectedCategory}
              onSelectCategory={setSelectedCategory}
            />
            <label className="section-search">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search events by name, category, or venue</span>
              <input
                type="search"
                placeholder="Search events..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
          </div>

          {featuredEvents.length > 0 && (
            <div className="featured-grid">
              {featuredEvents.map((event) => (
                <EventCard event={event} key={event.id} />
              ))}
            </div>
          )}

          {filteredEvents.length === 0 && (
            <div className="empty-state" role="status">
              <Search size={23} aria-hidden="true" />
              <h3>No events found just yet.</h3>
              <p>Try another search or choose a different category.</p>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  setSelectedCategory('All')
                }}
              >
                Clear filters <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
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
            <a href="#login" id="login">Login</a>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© 2026 CampusConnect. Made for campus life.</span>
          <span>Login access is coming soon.</span>
        </div>
      </footer>
    </div>
  )
}

export default App
