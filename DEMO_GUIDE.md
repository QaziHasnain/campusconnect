# CampusConnect Demo Guide

## Before the demonstration

1. Start PostgreSQL. Do not create or alter any database as part of this feature implementation.
2. Configure the repository-root `.env` with that database, a local `FRONTEND_ORIGIN`, and a random `SESSION_SECRET`. Do not show `.env` or the local credentials file during a screen share.
3. Do not apply a migration or seed to the existing `CampusConnect` or `campusconnect_demo`
   databases. The venue/payment migration is additive and remains unapplied; database testing for
   this work is restricted to `campusconnect_test`, after verifying the connected PostgreSQL
   database name.
4. Do not run the seed or perform database-backed write scenarios against `CampusConnect` or
   `campusconnect_demo`. Use those existing records only for read-only presentation checks. Any
   write/integration testing for this task must target `campusconnect_test` after checking the
   database identity.
5. Start the app with `npm run dev`. Open `http://localhost:5173`; the API defaults to `http://localhost:3000`.
6. Verify that the API and database are available before presenting registration or account-dependent flows.

The seed creates one organizer, two students, five published events, one draft, and four registrations. It is repeatable and does not delete database records. Do not run it against a shared, development, or production database.

## Public information pages

### About CampusConnect

1. Open `/about` from the site navigation.
2. Review the platform introduction, story, mission, vision, objectives, supported features, and technology stack.
3. Use the calls to action to visit the event list or account registration.

### How It Works

1. Open `/how-it-works`.
2. Walk through the student journey from student account creation to registrations.
3. Walk through the organizer journey, emphasizing that organizer access is provisioned rather than selectable during public sign-up.

### FAQ and help

1. Open `/faq`.
2. Expand questions with keyboard or pointer input.
3. Review the accurate limits around duplicate registrations, capacity, organizer authorization, password reset, and unsupported waitlists.

## Walkthrough scenarios

### 1. Student registration and login

1. Open the registration page and create a new account with a new email.
2. Confirm that registration creates an unverified student account and sends a verification email.
3. In development, use the local verification URL logged by the API when SMTP is not configured; otherwise open the message from the configured SMTP provider.
4. Verify the address and sign in with the same account.
5. Log out, then sign in again to confirm the verified account remains valid.

**Expected:** The account is a student; public registration does not offer organizer role selection. A PostgreSQL-backed local setup is required for an end-to-end persisted demonstration, and unverified users are blocked from login before account activation.

### 2. Browse published events

1. Open the landing page.
2. Review event cards and use the category filter.
3. Confirm that the draft event is not shown in public browsing.

**Expected:** Published event cards show their available summary. The demo data includes multiple categories and both limited-capacity and unlimited-capacity events.

### 3. View detailed event information

1. Choose View details on a published event card.
2. Review its full description, title, category, date/time, venue, organizer name, and registration controls.
3. If a maximum capacity is configured, review that limit.
4. If venue coordinates are available, review the attributed map and open **Get Directions**.

**Capacity note:** Current registration counts are not included in the public API, so remaining seats are not displayed. Unpublished, deleted, and unknown event IDs are not exposed and show an unavailable state.

Events without coordinates do not display a map marker. When an address is available, **Get
Directions** opens Google Maps using that address; otherwise it uses the event's venue text.

### 4. Register and demonstrate duplicate prevention

1. Sign in as a student who is not registered for a chosen published event.
2. Register for that event and confirm the registered state or success feedback.
3. Attempt to register for the same event again.
4. Open the student's registrations page.

**Expected:** The first registration succeeds, the duplicate is rejected, and the registration appears in the student's list. A live API and PostgreSQL database are required.

### 5. Organizer login and dashboard

1. Sign out from the student account.
2. Sign in with the organizer email and the password stored in the local-only credential file.
3. Open the organizer dashboard and review the seeded events.

**Expected:** The dashboard lists only events owned by that organizer. This seeded account is created through the guarded local Prisma script, not public signup.

### 6. Create an event

1. From the dashboard, choose the create-event action.
2. Enter the required title, description, category, venue, start time, and optional end time/capacity.
3. Save as a draft, then return to the dashboard.

**Expected:** The event appears in the organizer's dashboard. Invalid fields should produce validation feedback.

### 7. Edit an event

1. Choose an event owned by the organizer and open its edit form.
2. Change a field and save.
3. Confirm the updated field on the dashboard or public listing, depending on publication status.

Organizers can optionally enter a separate venue address, select coordinates on the map, and set an
INR ticket price. Blank ticket price remains a free event. The venue map picker starts without a
selected venue marker; click a position or enter a valid coordinate pair.

### Paid-event test checkout

1. Configure only Razorpay **Test Mode** key ID, key secret, and webhook secret in the API's local
   environment as documented in [docs/payments-setup.md](./docs/payments-setup.md).
2. Create and publish a paid event with a price in INR.
3. Sign in as a verified student and choose **Pay and register**.
4. Use only Razorpay's official test payment details. Confirm a captured test payment is registered;
   verify a failed or dismissed attempt can be retried.
5. Confirm the payment state and registration list. Do not use a real payment instrument.

Automated payment tests mock Razorpay and make no external transactions. The live payment mode is
disabled. The migration must not be applied to the existing demo database; do not run this scenario
against that database.

### 8. Publish and unpublish

1. Publish a draft event from the dashboard.
2. Confirm it appears in public browsing.
3. Unpublish it and confirm it is no longer shown publicly.

**Expected:** Publishing state maps to the event's existing `DRAFT`/`PUBLISHED` status.

### 9. Delete an event

1. Choose an organizer-owned event.
2. Use the delete action and confirm the dialog.
3. Confirm it no longer appears in the organizer's list.

Choose an event without registrations or payment attempts for this demonstration. The database
preserves event history through those relationships.

### 10. Forgot password and reset

1. Open Forgot Password and submit an email address.
2. Confirm the generic response.
3. With SMTP configured, open the email delivered by the configured provider. For local development without SMTP, use the reset URL logged by the API only when `NODE_ENV=development` and the configured frontend origin is localhost.
4. Submit a valid new password on the reset page.
5. Sign in using the new password and verify the prior password no longer works.

**SMTP requirement:** Email inbox delivery requires all SMTP settings in `.env`. Without SMTP, the local-development link path is available; production verification and reset delivery require SMTP. Do not paste a verification token, reset token, or credential into screenshots, logs, or shared chat.

### 11. Verify student authorization

1. Sign in as a student and attempt to navigate directly to `/organizer`.
2. If demonstrating API behavior, attempt an organizer mutation with the student's session.

**Expected:** The frontend denies the protected page and the API rejects organizer-only actions. The server-side check is authoritative. API-level tests cover authorization; a live API/database is needed to demonstrate actual requests.

### 12. Notification centre and reminder preferences

1. Sign in as a student and open the bell in the navigation or visit `/notifications`.
2. Review notification history, unread count, and the per-notification and mark-all read actions.
3. Use **Preferences** to turn in-app notifications, event reminders, or event updates on and off.
4. If browser push is configured and supported, choose **Enable** and explicitly accept the browser
   permission prompt. Do not grant permission automatically or during a screen share without consent.
5. To turn browser push off, use the notification preference control and confirm that the current
   device subscription is removed.

**Expected:** Notification history and unread state belong to the signed-in student. Browser push is
optional and independent of in-app history. Reminder notifications are scheduled 24 hours and 1
hour before registered published events by the native notification worker. Push previews contain
generic text rather than event details. No real push or WhatsApp messages are sent in automated
tests.

For VAPID configuration, local secure-context requirements, and worker startup, see
[docs/notifications-setup.md](./docs/notifications-setup.md). Applying the new migration is a
manual operator step; do not apply it to the demo database without explicit approval.

## Scenario dependencies

| Scenario | Requires |
|---|---|
| Static landing page layout | Frontend |
| Persisted signup/login, event data, organizer workflows, and registrations | Running API and PostgreSQL database |
| Venue map rendering | Frontend; venue coordinates for a marker; internet access for map tiles |
| Razorpay Checkout | Verified student, Razorpay test credentials, and a published paid event |
| Razorpay webhook delivery | Test-mode webhook configured to a reachable HTTPS test endpoint |
| Verification and password reset delivered to an inbox | SMTP configuration and access to the receiving inbox |
| Local development verification or reset link | Development API and localhost `FRONTEND_ORIGIN`; link is logged locally |
| Automated PostgreSQL integration suites | Dedicated local `campusconnect_test` database only; otherwise leave disabled |

## WhatsApp reminder preferences

WhatsApp reminders are disabled unless the API/worker environment explicitly enables the Meta
integration. No real messages are sent in automated tests.

1. Sign in with a student account and open **My registrations**.
2. Confirm WhatsApp reminders are marked unavailable unless Meta is fully configured.
3. Enter an international phone number, review the transactional reminder notice, and opt in
   explicitly. Saving a phone number without checking consent does not opt in.
4. Save, confirm the normalized international number and consent state, then uncheck the box and
   save to withdraw consent.

Reminder delivery requires the approved Meta template, configured API credentials, a running worker,
and future published events. Follow [docs/whatsapp-setup.md](./docs/whatsapp-setup.md) for Meta
configuration and a safe setup. Do not enable provider credentials or real sending during a demo
unless the recipient has explicitly opted in and the provider/template setup is complete.

For PostgreSQL tests, use a dedicated local database named `campusconnect_test` and leave the
integration flag disabled unless the root `.env` is pointed at that exact database. Never run
integration tests against `campusconnect_demo`, `CampusConnect`, or another working database.

## Browser and responsive checks

Use the running frontend and capture real screens only. Check both a desktop viewport (for example 1440 × 900) and a narrow mobile viewport (for example 390 × 844), including scrolling and form validation. Do not include passwords, reset tokens, session cookies, or environment configuration in screenshots.

## Screenshot checklist

- [ ] Landing page and published event browsing
- [ ] Homepage feature, workflow, about, and FAQ previews
- [ ] About page, including mission/objectives and technology section
- [ ] How It Works student and organizer journeys
- [ ] FAQ page, including an expanded accessible answer
- [ ] Detailed event page with organizer and schedule information
- [ ] Detailed event page showing configured maximum capacity, where applicable
- [ ] Event details with an address, map marker, visible OpenStreetMap attribution, and directions link
- [ ] Event details without coordinates (no venue marker is shown)
- [ ] Organizer form with optional address, map picker, and ticket price
- [ ] Paid event checkout states using Razorpay test mode only
- [ ] Unpublished or nonexistent event unavailable state
- [ ] Login page
- [ ] Student registration page
- [ ] Event card details as displayed in the list (not a dedicated detail page)
- [ ] Registration success/registered state
- [ ] Student registrations page
- [ ] Organizer dashboard and its empty state, if available
- [ ] Create-event form and validation feedback
- [ ] Edit-event form
- [ ] Forgot-password confirmation
- [ ] Reset-password form and success/error feedback
- [ ] Student denied access to organizer functionality
- [ ] Shared navigation and footer on desktop and mobile
- [ ] Desktop and mobile views of the organizer dashboard and event forms
- [ ] Desktop and mobile views of About, How It Works, FAQ, and event details

Capture only screens that are available and working in the local environment. A checklist item is not evidence that the flow was tested; mark any unavailable screen as not captured in the presentation notes.
