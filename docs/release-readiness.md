# Release readiness report

This report records Stage 6 checks against the local `campusconnect_demo` database. It is not a production deployment sign-off.

## Application verification

| Area | Result | Evidence / notes |
|---|---|---|
| Local API startup | PASS | API health endpoint responded on port 3001. |
| Local frontend startup | PASS | Vite served the UI on port 5174. |
| Database target | PASS | PostgreSQL identity was checked as `campusconnect_demo` before API startup. |
| CORS | PASS | Preflight allowed the exact origin `http://localhost:5174` with credentials. |
| Session and login | PASS | Student registration/session and organizer login were exercised through the UI; `/api/auth/me` reported an authenticated organizer session. |
| Student event discovery and registration | PASS | Seeded published events were browsed; a temporary student registered through the UI (HTTP 201) and saw the event in My Registrations. |
| Organizer management | PASS | Organizer dashboard and create/edit forms loaded through the authenticated UI. No seeded event was edited. |
| Password recovery | PASS | The real forgot-password UI returned HTTP 202; an isolated current-database-time expiry attempt returned HTTP 400. |
| Screenshots | PASS | 15 real browser screenshots saved under `screenshots/`, including authenticated organizer/student views and a 390px mobile homepage. |
| Database integrity | PASS | Final baseline: 1 organizer, 2 students, 6 seeded events, 5 registrations, 0 reset tokens; temporary test accounts removed. |

No database reset or seeding was performed for these checks. Screenshots are saved under [`screenshots/`](./screenshots/).

## Final validation

| Command/check | Result |
|---|---|
| `npm run build` | PASS — web and API builds completed. |
| `npm run lint -w apps/web` | PASS — Oxlint completed with no findings. |
| `RUN_DB_INTEGRATION_TESTS=false npm test` | PASS — 33 passed; 10 skipped, including opt-in database suites. |
| PostgreSQL reset-expiry suite on local `campusconnect_demo` | PASS — 8 passed. |
| `git diff --check` | PASS — no whitespace errors. |
| `npm audit --omit=dev` | FAIL — 1 high-severity Nodemailer finding. |
| Full `npm audit` | FAIL — 2 high-severity findings (Nodemailer and transitive Lodash). |

No forced upgrade or dependency change was performed. A non-forced audit-fix dry run proposed a Lodash patch update but also package removals, so it was not applied without a deliberate dependency review.

## Security review

- **Authentication and authorization:** public registration forces `STUDENT`; event routes check role and organizer ownership on the server. Ownership is checked before edit and delete. The organizer creation endpoint derives the organizer ID from the authenticated session.
- **Sessions:** `express-session` uses the PostgreSQL store, `httpOnly`, a 24-hour cookie lifetime, and `secure` in production. Production uses `SameSite=None`. The API does not configure Express `trust proxy`; behind Render TLS termination this can prevent secure cookies from being recognized/sent correctly. The existing hosted login/session problem is unresolved and must be retested after a targeted proxy/session fix.
- **Password reset:** random 256-bit tokens are hashed with SHA-256 before storage, requests are generic and rate-limited, expiration is set and checked using PostgreSQL `clock_timestamp()`, consumption is atomic, and password/session changes share a transaction. The exact-expiry regression is covered by the opt-in PostgreSQL suite.
- **Input and errors:** Zod schemas strictly validate auth and event inputs; API responses use explicit status codes and do not return password hashes. SMTP/reset delivery errors preserve the generic forgot-password response to limit account disclosure.
- **Database ownership:** updates and deletes require authenticated ownership. Registration uniqueness is backed by a database constraint; capacity is guarded by a transaction that locks the event row.
- **Operational limitations:** auth/reset rate-limit buckets are in-memory and reset on process restart; they are not coordinated across multiple API instances.

### Dependency advisories

`npm audit --omit=dev` reported **one high-severity advisory affecting installed Nodemailer 7.0.13**. The advisory output reports affected versions through `10.1.3`; the suggested fix is `10.3.1`, a major-version upgrade outside the current dependency range. SMTP is optional and was not configured for the local demo. Do not enable public SMTP until Nodemailer is upgraded deliberately, any migration impact is reviewed, and the production audit is clean.

The full audit reported **one additional high-severity advisory for Lodash 4.17.21**, pulled in through Prisma Studio's `@visx` dependencies. It is a development/tooling dependency and is not included in `npm audit --omit=dev`. The available dry-run proposed a compatible patch update but also showed tooling-package removals, so it was not applied without a focused lockfile review. No forced dependency upgrade was performed.

## Deployment readiness

**Status: BLOCKED for public hosted authentication.** The Render login/session issue remains unresolved; no production login/session verification is claimed.

- No Render blueprint or service configuration file was found in the repository. Confirm the web/API service commands, build/start commands, health checks, environment variables, and database binding in the Render dashboard.
- Confirm HTTPS frontend/API origins, exact `FRONTEND_ORIGIN`, and `VITE_API_URL`; credentialed requests must use the correct origins.
- Diagnose the production secure-cookie behavior through Render's proxy before considering authentication fixed. Test login, refresh persistence, logout, reset-session invalidation, and cross-origin credentialed requests on the deployed environment.
- Express does not set `trust proxy`, which may affect production secure-cookie behavior and client-IP-based password-reset rate limits behind Render's proxy. Configure proxy trust narrowly and verify the actual proxy topology rather than applying a blanket setting.
- The current `/api/health` handler returns success without checking database connectivity; add or configure a readiness check that verifies required dependencies before using it as a deployment readiness signal.
- Configure and verify SMTP delivery before enabling password recovery outside local development. Do not use the development reset-link log path in production.
- Apply committed migrations to the intended hosted database only after taking a backup and verifying the target. Never use a reset migration command.
- Resolve the Nodemailer high-severity advisory before using the SMTP integration.
- Add shared rate limiting and operational monitoring before scaling beyond one API process.

No production connection, configuration changes, or deployment were performed for this report.

## Known limitations and roadmap

1. Fix and verify the Render secure-session/login issue; add deployment-specific regression coverage.
2. Upgrade Nodemailer to a reviewed non-vulnerable release and re-run the full audit.
3. Add automated browser tests covering student, organizer, password-reset, and mobile layouts.
4. Move rate limiting to shared storage before running multiple API instances.
5. Define registration cancellation/waitlist behavior and add stronger capacity concurrency coverage.
6. Add hosted health checks, structured logs, and SMTP delivery monitoring.
7. Consider exposing registration counts if the product needs remaining-capacity indicators.
