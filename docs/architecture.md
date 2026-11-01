# Architecture

CampusConnect is a TypeScript monorepo with a React single-page application, an Express API, and a PostgreSQL database. The API is the security boundary: it validates requests, derives user identity from a server-side session, enforces roles and event ownership, and persists state with Prisma.

## Component diagram

```mermaid
flowchart LR
  Browser["Browser: React 19 + Vite"] -->|"JSON requests + session cookie"| API["Express 5 API"]
  API --> Auth["Auth and session middleware"]
  API --> Events["Event and registration routes"]
  Auth --> Prisma["Prisma Client + PostgreSQL adapter"]
  Events --> Prisma
  Prisma --> DB[("PostgreSQL")]
  Auth -. "optional password reset email" .-> SMTP["SMTP provider via Nodemailer"]
  DB --- Users["User"]
  DB --- Event["Event"]
  DB --- Registration["Registration"]
  DB --- ResetToken["PasswordResetToken"]
  DB --- Session["session"]
```

## Request flow

1. React Router renders a public, student, or organizer page.
2. The frontend calls the API with JSON and `credentials: include`; Vite can proxy to a different API origin through `VITE_API_URL`.
3. Express applies Helmet, exact-origin credentialed CORS, JSON parsing, and PostgreSQL-backed session middleware.
4. Route schemas validate user-controlled input. Protected endpoints resolve the session user and check the current database role.
5. Repository methods use Prisma and PostgreSQL transactions/constraints for persistent operations.
6. The API returns JSON and an appropriate HTTP status; frontend components render loading, error, and success states.

The API defaults to `http://localhost:3000`; the Vite development server defaults to `http://localhost:5173`. Configure the exact frontend origin in `FRONTEND_ORIGIN`. In production, HTTPS and correct reverse-proxy/session configuration are required; see [release readiness](./release-readiness.md).

## Workspace structure

```text
apps/
  api/
    prisma/
      migrations/       Ordered Prisma SQL migrations
      schema.prisma     PostgreSQL data model
      seed-demo.ts      Explicitly guarded local demo upserts
    src/
      auth.ts           Registration, login, reset and auth validation
      events.ts         Event, organizer, and registration routes
      app.ts            Express middleware, Prisma repositories, router wiring
      auth*.test.ts     Auth unit and opt-in PostgreSQL regression tests
      events*.test.ts   Event unit and opt-in PostgreSQL tests
  web/
    src/
      App.tsx           Routes and landing page
      auth/             Auth context and account/recovery pages
      components/       Shared site layout, cards, and controls
      pages/            Student, organizer, and public pages
      lib/              API request and data mapping helpers
packages/
  shared/               Shared workspace package
docs/
  architecture.md
  release-readiness.md
  screenshots/
```

## Database design

The Prisma schema is [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma).

```mermaid
erDiagram
  USER ||--o{ EVENT : organizes
  USER ||--o{ REGISTRATION : makes
  EVENT ||--o{ REGISTRATION : receives
  USER ||--o{ PASSWORD_RESET_TOKEN : owns
  USER {
    string id PK
    string email UK
    string passwordHash
    UserRole role
  }
  EVENT {
    string id PK
    string organizerId FK
    EventStatus status
    EventCategory category
    int capacity
  }
  REGISTRATION {
    string id PK
    string userId FK
    string eventId FK
    unique userId_eventId
  }
  PASSWORD_RESET_TOKEN {
    string id PK
    string userId FK
    string tokenHash UK
    timestamptz expiresAt
  }
  SESSION {
    string sid PK
    json sess
    timestamp expire
  }
```

- A user has role `STUDENT` or `ORGANIZER`. Public sign-up always assigns `STUDENT`.
- A user may own many events. New events default to `DRAFT`; only published events are returned by public event reads.
- Registrations associate students with events. The unique `(userId, eventId)` database constraint protects against duplicates. A transaction locks an event while checking capacity and creating a registration.
- Reset tokens are random, single-use bearer credentials. Only the SHA-256 token hash and database-clock expiry are stored. Consumption and password/session updates run in one transaction.
- Express session rows use the mapped `session` table and are separate from Prisma's application models.

## Trust boundaries

- The browser is not trusted to assert user IDs, roles, ownership, or event status.
- API validation and authorization are repeated on the server even when the UI hides controls.
- Organizer updates/deletes scope their database writes to both the event and session organizer.
- Secrets are supplied via the root `.env` for local work and should use the hosting provider's secret manager in production.
- The demo seed refuses remote database hosts, unapproved database names, missing acknowledgements, and `NODE_ENV=production`; it upserts rather than resetting data.
