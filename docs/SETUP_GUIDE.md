# CampusConnect local setup guide

This guide sets up CampusConnect for local development on Windows PowerShell. It covers both a new local database and an existing configured development environment. Do not run database commands until you have confirmed the database named in `.env`.

## Requirements

- Node.js **22.19 or newer** and npm. The committed lockfile includes `undici` requiring Node 22.19 or newer; use a current supported Node 22 or 24 release.
- PostgreSQL, running locally, with permission to create a database and connect to it.
- Git.

The repository is an npm workspaces monorepo named `campusconnect`, with workspaces `apps/web`, `apps/api`, and `packages/shared`. The committed `package-lock.json` is the dependency lockfile.

## Clone and install

In PowerShell, choose a local folder and run:

```powershell
git clone <repository-url>
Set-Location campusconnect
npm ci
```

Replace `<repository-url>` with the repository's actual clone URL. No URL is embedded here because it is not configured in the project documentation.

## Configure the local environment

The API and Prisma read the repository-root `.env`; the checked-in `.env.example` is the source for its variable names and local defaults. Create the local file:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set:

- `DATABASE_URL` to the PostgreSQL database you created. The example uses `postgresql://postgres:postgres@localhost:5432/campusconnect?schema=public`; change the user, password, host, port, and database to match your local PostgreSQL installation.
- `SESSION_SECRET` to a random string at least 32 characters long.

The example sets `NODE_ENV=development`, `PORT=3000`, `FRONTEND_ORIGIN=http://localhost:5173`, and `VITE_API_URL=http://localhost:3000`. Leave those defaults unless your local ports/origins differ; if you change a port or origin, keep `FRONTEND_ORIGIN` and `VITE_API_URL` consistent with your frontend and API. Keep `.env` private and out of source control.

Razorpay, SMTP, browser push, WhatsApp, and map tile settings are optional. The app can run without provider credentials; paid checkout and outbound delivery are unavailable until configured. Razorpay is **Test Mode only**. The web workspace has its own `.env.example`, but the root example already contains the local `VITE_API_URL` and map settings used by this repository.

## Fresh local database: create and migrate

Use this section only when creating a completely fresh database for this checkout. Create a database in PostgreSQL using your preferred local administration tool or SQL client. For example, in `psql` connected as a role allowed to create databases:

```sql
CREATE DATABASE campusconnect;
```

Set the root `.env` `DATABASE_URL` to that exact local database and verify its host and database name before proceeding. Then apply the committed development migrations:

```powershell
npm run db:migrate:dev -w apps/api
```

This runs the API workspace's `prisma migrate dev` script using `apps/api/prisma.config.ts`, `apps/api/prisma/schema.prisma`, and migrations in `apps/api/prisma/migrations/`. Review any migration prompt carefully and stop if the selected database is not the fresh local database you intended. Do not use reset commands. The application does not require seed data to start; do not run seed scripts as part of normal setup.

### Existing configured local development database

If you already have a local database whose schema is configured for this project, do not recreate it and do not rerun the fresh-database steps. Confirm its identity and current migration status before making changes. To apply committed migrations to a known local development database, use:

```powershell
npm run db:migrate -w apps/api
```

This runs `prisma migrate deploy`. It changes the database schema. Only run it after confirming the exact local target and deciding that applying pending migrations is intended. If the existing environment is already configured and current, skip migrations and continue to start the app.

## Start the application

From the repository root, start both workspaces:

```powershell
npm run dev
```

Open the frontend at <http://localhost:5173>. The API defaults to <http://localhost:3000>; check its health endpoint at <http://localhost:3000/api/health>, which returns JSON `{ "status": "ok" }` when the API responds. This endpoint confirms API responsiveness and does not perform a database readiness check.

To run each workspace in its own PowerShell terminal instead:

```powershell
npm run dev -w apps/web
```

```powershell
npm run dev -w apps/api
```

Optional notification delivery workers are separate processes. Start one only when testing the corresponding configured integration:

```powershell
npm run worker:notifications -w apps/api
```

```powershell
npm run worker -w apps/api
```

## Accounts and demo walkthrough

Public sign-up provisions student accounts only. Organizer access is not available through public registration; use an organizer account provisioned for your local environment. The repository has a guarded demo seed for a dedicated local demo database, but it is not required for setup. Read [DEMO_GUIDE.md](../DEMO_GUIDE.md) for the actual student/organizer walkthrough and the demo-seed safeguards. Never copy local passwords or credential files into project documentation, screenshots, or source control.

## Tests, lint, and production builds

Run these from the repository root:

```powershell
npm test
npm test -w apps/web
npm test -w apps/api
npm run lint -w apps/web
npm run build
```

The root test script runs each workspace's test script where present. API tests run with one worker. PostgreSQL integration suites are opt-in and require the dedicated local `campusconnect_test` database; the default test command does not run them. Do not point integration tests at a demo, shared, or production database. The root build script builds the web workspace and then the API workspace.

## Troubleshooting

- **`npm ci` reports an unsupported Node version:** install Node.js 22.19 or newer, reopen PowerShell, and check `node --version` and `npm --version`.
- **API startup reports missing/invalid environment values:** confirm the repository-root `.env` exists, `DATABASE_URL` is a PostgreSQL URL, and `SESSION_SECRET` is at least 32 characters. Prisma also loads this root file through `apps/api/prisma.config.ts`.
- **Database connection refused or authentication failed:** start PostgreSQL and compare the user, password, host, port, and database in `DATABASE_URL` with your local server configuration. Ensure the database exists.
- **Migration command targets an unexpected database:** stop immediately. Inspect `.env` and confirm the database identity before retrying; never use a reset command to work around a mismatch.
- **Frontend API requests fail:** confirm the API is running, then verify `VITE_API_URL` and `FRONTEND_ORIGIN` match the actual local API and frontend origins. The defaults are ports 3000 and 5173.
- **Maps do not show tiles:** verify the browser has internet access and inspect `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION`. Map tiles are optional and depend on the provider.
- **Email or paid checkout is unavailable:** these features need the relevant optional SMTP or Razorpay Test Mode configuration. See [email setup](./email-setup.md) and [payments setup](./payments-setup.md); never use live Razorpay credentials.

For component responsibilities and request flow, see [architecture](./architecture.md). For feature-specific configuration, see [payments](./payments-setup.md), [email](./email-setup.md), [maps](./maps-setup.md), [notifications](./notifications-setup.md), and [WhatsApp](./whatsapp-setup.md).
