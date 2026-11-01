import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleHelp,
  Compass,
  MapPin,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { EventRegistrationControl } from '../components/EventRegistrationControl'
import {
  ApiError,
  apiRequest,
  eventResponseSchema,
} from '../lib/api'
import type { ApiEvent } from '../lib/api'
import { formatEventDateTime } from '../lib/eventFormatting'
import './PublicPages.css'

const objectives = [
  'Centralize campus event information.',
  'Simplify student event discovery.',
  'Make event registration convenient.',
  'Give organizers event-management tools.',
  'Improve campus participation and communication.',
]

const studentSteps = [
  ['Create an account', 'Register with your name, email, and password. Public sign-up creates a student account.'],
  ['Explore campus events', 'Browse published events and narrow the list by category or search.'],
  ['View event details', 'Open an event to see its full description, schedule, venue, organizer, and configured capacity.'],
  ['Register for an event', 'Sign in as a student and use the event registration control. Duplicate registration is prevented.'],
  ['View registered events', 'Visit My Registrations to review events linked to your student account.'],
]

const organizerSteps = [
  ['Obtain an authorized organizer account', 'Public registration creates student accounts. Organizer access must be provisioned through trusted administration.'],
  ['Open the organizer dashboard', 'Sign in with the authorized organizer account to view events you own.'],
  ['Create an event', 'Enter the event title, description, category, venue, schedule, and optional capacity. New events start as drafts.'],
  ['Edit event information', 'Update the details of an event owned by your account.'],
  ['Publish when ready', 'Publish an event to make it visible to students, or unpublish it back to draft.'],
  ['Manage your events', 'Review event status, edit details, publish or unpublish, and delete events without registrations.'],
]

const faqItems = [
  {
    question: 'What is CampusConnect?',
    answer: 'CampusConnect is a campus event discovery and registration platform. Students browse and register for published events, while authorized organizers manage events they own.',
  },
  {
    question: 'How do students create accounts?',
    answer: 'Use the registration page with a name, email address, and password. Public registration creates a student account; organizer roles are not selectable during sign-up.',
  },
  {
    question: 'How can students discover events?',
    answer: 'Browse the published events on the home page. Search by event name, description, or venue, and filter by the available event categories.',
  },
  {
    question: 'How does event registration work?',
    answer: 'Sign in with a student account and choose Register on a published event. Your registrations are available from My Registrations.',
  },
  {
    question: 'Can students register more than once?',
    answer: 'No. The API checks for an existing registration, and the database enforces uniqueness for each student/event pair.',
  },
  {
    question: 'How can organizers create events?',
    answer: 'An authorized organizer signs in, opens the organizer dashboard, and uses the create-event form. New events are saved as drafts and can be published when ready.',
  },
  {
    question: 'How are organizer permissions handled?',
    answer: 'The server checks the signed-in user role. Event edits and deletions are also restricted to events owned by that organizer. Public sign-up cannot grant organizer permissions.',
  },
  {
    question: 'How does capacity management work?',
    answer: 'Organizers may set an optional maximum capacity. Registration requests are rejected when the event is full. The interface does not currently show remaining seat counts.',
  },
  {
    question: 'How can users reset forgotten passwords?',
    answer: 'Use Forgot Password and follow the reset link. Email delivery requires the application SMTP provider to be configured; local development can use the localhost-only development link path.',
  },
  {
    question: 'What happens when an event is full?',
    answer: 'The API rejects new registrations with a full-event response, and the interface displays a clear message. There is no waitlist.',
  },
]

function PageHero({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string
  title: string
  description: string
  icon: LucideIcon
}) {
  return (
    <header className="public-page-hero">
      <span className="public-hero-icon"><Icon size={24} aria-hidden="true" /></span>
      <span className="eyebrow section-eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

export function AboutPage() {
  return (
    <main className="public-page">
      <section className="about-hero public-page-hero">
        <div>
          <span className="eyebrow section-eyebrow">CAMPUS LIFE, CONNECTED</span>
          <h1>About CampusConnect</h1>
          <p>
            A clearer way to find what’s happening on campus—and a simpler way
            for organizers to bring people together.
          </p>
          <div className="public-hero-actions">
            <Link className="button button-primary" to="/#events">
              Discover events <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link className="text-button" to="/how-it-works">
              How it works <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <div className="about-illustration" aria-hidden="true">
          <div className="about-illustration-orbit" />
          <div className="about-illustration-card">
            <CalendarDays size={32} />
            <span>One campus</span>
            <strong>More ways to connect.</strong>
          </div>
          <span className="about-illustration-dot about-illustration-dot-one" />
          <span className="about-illustration-dot about-illustration-dot-two" />
        </div>
      </section>

      <section className="public-content-section story-section">
        <div className="public-section-intro">
          <span className="eyebrow section-eyebrow">OUR STORY</span>
          <h2>Campus events deserve a clear home.</h2>
        </div>
        <div className="story-copy">
          <p>
            Students often have to check different channels to discover what’s
            happening around college. Important event details can be scattered
            across posts, messages, and announcements.
          </p>
          <p>
            Organizers also need a centralized way to create events, manage
            their information, and accept registrations. CampusConnect brings
            those needs together so students can find and participate in
            campus activities more easily.
          </p>
        </div>
      </section>

      <section className="mission-vision-section">
        <article className="mission-card">
          <span className="eyebrow section-eyebrow">OUR MISSION</span>
          <h2>Make campus events easier to discover, organize and participate in.</h2>
        </article>
        <article className="vision-card">
          <span className="eyebrow section-eyebrow">OUR VISION</span>
          <h2>Build a connected campus community through accessible digital event management.</h2>
        </article>
      </section>

      <section className="public-content-section objectives-section">
        <div className="public-section-intro">
          <span className="eyebrow section-eyebrow">WHAT WE AIM TO DO</span>
          <h2>Our objectives</h2>
        </div>
        <ul className="objective-list">
          {objectives.map((objective) => (
            <li key={objective}><Check size={18} aria-hidden="true" />{objective}</li>
          ))}
        </ul>
      </section>

      <CallToAction />
    </main>
  )
}

export function HowItWorksPage() {
  return (
    <main className="public-page">
      <PageHero
        eyebrow="A SIMPLE WAY TO GET INVOLVED"
        title="How CampusConnect works"
        description="A clear path from finding a campus event to joining in—or organizing one for your community."
        icon={Compass}
      />
      <section className="journeys-section">
        <Workflow title="For Students" intro="Find an event that interests you and keep your campus plans in one place." steps={studentSteps} />
        <Workflow title="For Organizers" intro="Manage events you own, from the first draft through publication." steps={organizerSteps} />
      </section>
      <div className="workflow-note">
        <ShieldCheck size={20} aria-hidden="true" />
        <p>Organizer accounts are provisioned by trusted administration. Public sign-up is for students.</p>
      </div>
      <CallToAction />
    </main>
  )
}

function Workflow({
  title,
  intro,
  steps,
}: {
  title: string
  intro: string
  steps: string[][]
}) {
  return (
    <section className="workflow-column" aria-label={title}>
      <header>
        <span className="eyebrow section-eyebrow">{title.toUpperCase()}</span>
        <h2>{title}</h2>
        <p>{intro}</p>
      </header>
      <ol className="workflow-steps">
        {steps.map(([stepTitle, description], index) => (
          <li key={stepTitle}>
            <span className="workflow-number">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h3>{stepTitle}</h3>
              <p>{description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function FaqPage() {
  return (
    <main className="public-page">
      <PageHero
        eyebrow="HELP AND ANSWERS"
        title="Frequently asked questions"
        description="Quick answers about accounts, event discovery, registration, and organizing."
        icon={CircleHelp}
      />
      <section className="faq-list" aria-label="Frequently asked questions">
        {faqItems.map(({ question, answer }) => (
          <details className="faq-item" key={question}>
            <summary>{question}<span aria-hidden="true">+</span></summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>
      <div className="faq-contact-note">
        <p>Still have a question?</p>
        <Link className="text-button" to="/#events">Browse campus events <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
    </main>
  )
}

export function EventDetailsPage() {
  const { eventId } = useParams()
  const [loadedEvent, setLoadedEvent] = useState<{
    eventId: string
    event: ApiEvent | null
    error: string | null
  } | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!eventId) return

    let cancelled = false
    void apiRequest(
      `/api/events/${encodeURIComponent(eventId)}`,
      eventResponseSchema,
    )
      .then(({ event: loadedEvent }) => {
        if (!cancelled) setLoadedEvent({ eventId, event: loadedEvent, error: null })
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        let error: string
        if (requestError instanceof ApiError && requestError.status === 404) {
          error = 'This event is no longer available. It may have been unpublished or removed.'
        } else if (requestError instanceof ApiError && requestError.status >= 500) {
          error = 'The event service is temporarily unavailable.'
        } else {
          error = 'We could not load this event. Check your connection and try again.'
        }
        setLoadedEvent({ eventId, event: null, error })
      })

    return () => {
      cancelled = true
    }
  }, [eventId, retry])

  const isLoading = Boolean(eventId && loadedEvent?.eventId !== eventId)
  const event = loadedEvent && eventId && loadedEvent.eventId === eventId ? loadedEvent.event : null
  const error = !eventId
    ? 'This event could not be found.'
    : loadedEvent && loadedEvent.eventId === eventId
      ? loadedEvent.error
      : null

  if (isLoading) {
    return <main className="public-page event-details-page"><div className="public-state" role="status">Loading event details…</div></main>
  }

  if (error || !event) {
    return (
      <main className="public-page event-details-page">
        <section className="public-state" role="status">
          <CalendarDays size={27} aria-hidden="true" />
          <h1>{error?.includes('no longer available') ? 'Event unavailable' : 'Event details unavailable'}</h1>
          <p>{error ?? 'This event could not be found.'}</p>
          {error && !error.includes('no longer available') && eventId && (
            <button className="button button-primary" type="button" onClick={() => {
              setLoadedEvent(null)
              setRetry((value) => value + 1)
            }}>
              Try again
            </button>
          )}
          <Link className="text-button" to="/#events"><ArrowLeft size={15} aria-hidden="true" /> Back to events</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="public-page event-details-page">
      <Link className="back-link" to="/#events"><ArrowLeft size={15} aria-hidden="true" /> All events</Link>
      <article className={`event-detail-card event-art--${event.category.toLowerCase()}`}>
        <div className="event-detail-art" aria-hidden="true">
          <CalendarDays size={64} strokeWidth={1.2} />
          <span>{event.category}</span>
        </div>
        <div className="event-detail-content">
          <span className="event-detail-category">{event.category}</span>
          <h1>{event.title}</h1>
          <div className="event-detail-meta">
            <p><CalendarDays size={18} aria-hidden="true" /><span><strong>Date and time</strong>{formatEventDateTime(event.startAt)}{event.endAt ? ` — ${formatEventDateTime(event.endAt)}` : ''}</span></p>
            <p><MapPin size={18} aria-hidden="true" /><span><strong>Venue</strong>{event.venue}</span></p>
            <p><UsersRound size={18} aria-hidden="true" /><span><strong>Organized by</strong>{event.organizer.name}</span></p>
            {event.capacity !== null && (
              <p><UsersRound size={18} aria-hidden="true" /><span><strong>Maximum capacity</strong>{event.capacity} attendees</span></p>
            )}
          </div>
          <section className="event-detail-description" aria-labelledby="event-description-title">
            <h2 id="event-description-title">About this event</h2>
            <p>{event.description}</p>
          </section>
          <div className="event-detail-register">
            <EventRegistrationControl eventId={event.id} eventTitle={event.title} />
          </div>
        </div>
      </article>
    </main>
  )
}

function CallToAction() {
  return (
    <section className="public-cta">
      <div>
        <span className="eyebrow section-eyebrow">YOUR NEXT CAMPUS MOMENT</span>
        <h2>Find something worth showing up for.</h2>
        <p>Explore published events or create a student account to register.</p>
      </div>
      <div className="public-cta-actions">
        <Link className="button button-primary" to="/#events">Discover events <ArrowRight size={16} aria-hidden="true" /></Link>
        <Link className="button public-cta-secondary" to="/register">Create an account</Link>
      </div>
    </section>
  )
}
