# Native notification setup

CampusConnect stores in-app notifications, event reminder schedules, notification preferences,
push subscriptions, and push delivery retries in PostgreSQL. Browser push uses the standard Web
Push API, service workers, VAPID, and the `web-push` Node.js package. It does not use WhatsApp,
Twilio, Firebase, or a paid notification platform.
The browser selects its own standard Web Push service endpoint; the application does not integrate
the Firebase SDK or provision a Firebase project.

## Database migration

The notification schema is in
[`apps/api/prisma/migrations/20261101232500_add_native_notifications/migration.sql`](../apps/api/prisma/migrations/20261101232500_add_native_notifications/migration.sql).
Migrations are not applied automatically. Review the migration and explicitly apply it only to the
intended database:

```sh
npm run db:migrate -w apps/api
```

For a local development database, Prisma's development workflow can create/apply migrations, but
do not use it against a shared, demo, or production database without approval. The notification
integration tests are guarded and may only run against a dedicated local database named
`campusconnect_test`.

## VAPID and subscription-encryption keys

Generate a VAPID key pair with the installed `web-push` package:

```sh
npx web-push generate-vapid-keys
```

Generate an independent 32-byte AES key for encrypting each stored device subscription:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set all four values in the API's secret environment:

```dotenv
PUSH_VAPID_PUBLIC_KEY=<generated-public-key>
PUSH_VAPID_PRIVATE_KEY=<generated-private-key>
PUSH_VAPID_SUBJECT=mailto:notifications@example.test
PUSH_SUBSCRIPTION_ENCRYPTION_KEY=<base64-32-byte-key>
```

Use a real contact address for `PUSH_VAPID_SUBJECT` in an actual deployment. Keep the private key
and encryption key secret, stable across restarts, and out of source control. The API returns only
the VAPID public key to an authenticated student. Push endpoint URLs and subscription keys are
encrypted at rest with AES-256-GCM; a SHA-256 endpoint digest is used for uniqueness and targeted
deletion. Back up these keys securely: changing the encryption key makes existing subscriptions
unreadable, and changing the VAPID pair requires clients to subscribe again.

Leave all four variables unset to disable browser push. In-app notifications and event reminders
remain available. Do not enable the existing WhatsApp integration as part of this setup.

## Browser and permission requirements

Web Push requires a browser that implements service workers, the Push API, and the Notifications
API. It is available only in a secure context: use HTTPS locally or `localhost` (which browsers
treat as secure). A remote HTTP origin will not be able to register the service worker or subscribe.
Support can differ for private browsing, embedded browsers, and mobile operating systems; some
mobile browsers require the site to be installed as a home-screen web app.

The application checks browser capability before presenting the enable action. Notification
permission is requested only after the student explicitly chooses **Enable** on the authenticated
`/notifications` page. Permission can also be denied or revoked in browser site settings. The
service worker is served from `/sw.js`; keep it on the application origin and scope.
For outbound-request safety, the API accepts secure subscription endpoints from the browser push
service domains used by Chrome/Edge, Firefox, Safari, and Windows; custom/private push endpoints
are rejected.

Push notification titles and lock-screen bodies are generic and do not include event names, venues,
or schedule details. Selecting a push opens the associated event within CampusConnect.

## Worker startup and operations

Apply the reviewed migration manually, configure the API environment, then run one or more
independent notification workers:

```sh
npm run worker:notifications -w apps/api
```

For a production build:

```sh
npm run build -w apps/api
npm run start:notification-worker -w apps/api
```

The worker can run alongside multiple API instances or other notification workers. PostgreSQL
`FOR UPDATE SKIP LOCKED` claims reminder and push-delivery rows, and unique constraints prevent
duplicate schedules and per-device deliveries. Claims use leases so work can resume after a process
restart. Database transactions end before any external push request.

The worker reconciles reminders for registered students and published future events at 24 hours and
1 hour before their start time (UTC). Each delivery rechecks the registration, event status and
start time, and current preferences. Changes to event time or publication status reschedule or
cancel pending reminders. Transient push failures use bounded retries; permanent 404/410 responses
remove the expired device subscription.

The scheduler is independent from `npm run worker -w apps/api`, the existing WhatsApp worker.
That integration remains disabled by default and is not changed by the native notification worker.

## Testing

Run unit/API tests without contacting a push service:

```sh
npm test -w apps/api
```

Push delivery is mocked in unit tests. PostgreSQL integration tests are disabled by default and
must use only a dedicated local database named `campusconnect_test`; never point them at the demo,
development, or production database.
