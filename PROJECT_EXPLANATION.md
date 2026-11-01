# CampusConnect — Project Explanation

## What CampusConnect does

CampusConnect is a web application for campus events. Students can browse published events, register for an event, and review their registrations. Organizers can manage events they own, including creating drafts, publishing or unpublishing events, editing details, and deleting events.

## Why it was developed

Campus activities are valuable when students can find and join them. When event announcements are spread across social media, email, posters, and separate department channels, information can be missed and organizers may have no consistent registration list. CampusConnect provides a shared system for publishing events and collecting registrations.

## How the system works

The system has a React frontend and an Express API. The frontend sends HTTP requests to the API. The API validates request data, checks the authenticated session and user role, applies business rules, and reads or writes records through Prisma. PostgreSQL stores users, events, registrations, password-reset tokens, and login sessions.

```text
Browser (React)
    | HTTP requests and session cookie
    v
Express API (authentication, validation, authorization)
    | Prisma / PostgreSQL adapter
    v
PostgreSQL
    |
    +-- Optional Nodemailer SMTP delivery for reset links
```

## Frontend architecture

The frontend is a Vite application written in TypeScript and React. React Router maps URLs to pages. Shared authentication context provides the current user to navigation and protected pages. API helpers centralize requests and include credentials so the browser can send the server-side session cookie.

The landing page lists published events and supports category filtering. It also introduces platform features and links to the student/organizer workflows, About page, and FAQ. Event cards link to dedicated detail pages with the full description, category, schedule, venue, organizer name, configured maximum capacity, and registration control. Students can see their registrations, and organizers have a dashboard with links to event creation and editing forms. The About, How It Works, and FAQ pages explain platform behavior and supported workflows. Forgot-password and reset-password pages handle user-facing password recovery.

The public API does not include registration totals, so event pages do not calculate remaining availability.

## Backend architecture

The backend is an Express 5 API implemented in TypeScript. Route modules handle authentication and event operations. Zod schemas validate incoming data. Prisma Client, configured with the PostgreSQL adapter, reads and writes the relational data. The API's environment configuration validates required settings at startup.

API errors use HTTP status codes and JSON responses. The backend is responsible for authorization; hiding a button in the frontend is not considered a security control.

## Authentication and authorization

Passwords are hashed with Argon2 and are not stored in plain text. Express sessions are stored in PostgreSQL, and the browser holds a session cookie. Login establishes the session; logout destroys it. Public registration always assigns the `STUDENT` role. Organizer accounts must be provisioned by a trusted administrator/demo seed rather than selected through public registration.

Organizer routes require an authenticated organizer. Event update and delete operations also scope the database operation to both the event ID and the authenticated organizer ID. Consequently, an organizer cannot use a guessed event ID to manage another organizer's event. Students cannot create or manage events.

## Database relationships

- A `User` may organize many `Event` records.
- A `User` may have many `Registration` records.
- An `Event` belongs to one organizer and may have many registrations.
- A `Registration` connects one user to one event. The database enforces uniqueness for the `(userId, eventId)` pair, preventing duplicate registrations.
- A `PasswordResetToken` belongs to one user and stores a unique token hash and expiration time.
- `Session` records support PostgreSQL-backed server-side sessions.

An event can have an optional capacity (`null` means no configured limit) and an optional end time. Only published events are available to students for registration.

## Event-management workflow

1. An authenticated organizer opens the organizer dashboard.
2. The dashboard requests that organizer's events from the API.
3. The organizer submits an event form; the API validates its fields and associates the event with the session user's ID.
4. The organizer can edit the event or change its status between `DRAFT` and `PUBLISHED`.
5. Student browsing and registration are limited to published events.
6. For update/delete, the API checks ownership in the database operation. The frontend asks for confirmation before deleting.

## Student-registration workflow

1. A student creates an account or signs in.
2. The frontend loads published events from the API.
3. The student submits a registration request for an event.
4. The API verifies the authenticated student and that the event is published.
5. The API rejects an existing registration and checks configured capacity before creating a new record.
6. The student can review their registrations. The unique database constraint provides a final duplicate-prevention safeguard.

## Password-reset security

The forgot-password endpoint responds generically so an unknown address is not distinguishable from a registered one. For a known account, the API generates a cryptographically random token, stores only its SHA-256 hash with a limited expiration, and sends the raw token only in a reset link. Reset attempts are rate-limited.

The reset endpoint hashes the submitted token and checks for a matching, unexpired record. A successful reset hashes the new password with Argon2, consumes the token, and invalidates existing sessions. An expired or reused token cannot reset the password. SMTP is optional for local development; when SMTP is unavailable, the application exposes a reset URL only in development on localhost, not in production logs.

## Major development challenges and solutions

- **Role escalation:** Public registration no longer accepts a role choice; it assigns `STUDENT`. Organizer provisioning is reserved for trusted setup.
- **Authorization at two levels:** Role checks protect organizer-only routes, while ownership checks restrict each mutation to the authenticated organizer's own event.
- **Duplicate registrations:** The API checks existing registrations and the database enforces a unique user/event pair.
- **Password recovery without account disclosure:** The request response is generic, tokens are stored hashed and expire, and rate limits constrain abuse.
- **Safe demonstrations:** Demo seeding is opt-in, local-host-only, limited to named demo/test databases, and uses a separate git-ignored local credential file. It does not reset or delete records.
- **Integration-test safety:** PostgreSQL integration suites must be run only against a dedicated test database, not an ordinary development or production database.

## Future improvements

- Add a dedicated event-details page and automated browser end-to-end tests.
- Add operational email-delivery observability and production SMTP configuration.
- Improve registration cancellation and capacity race-condition handling with explicit product requirements and transaction-level tests.
- Add deployment-specific session/cookie validation and monitoring before relying on hosted authentication.
- Expand accessibility, mobile-browser, and cross-browser verification.
