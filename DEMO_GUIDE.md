# CampusConnect Demo Guide

This walkthrough is for a local coursework/portfolio presentation. Use a local organizer account and a verified student account. Public sign-up creates student accounts only; organizer access is provisioned separately as described below. Keep `.env` and `.demo-credentials.local.json` private and off screen. For a new checkout, follow the [setup guide](./docs/SETUP_GUIDE.md) first.

## Prepare the local app

1. Install dependencies with `npm ci` from the repository root.
2. Configure the repository-root `.env` with the local `DATABASE_URL` and `SESSION_SECRET`. Configure `RAZORPAY_MODE=test`, `RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET` only if you will demonstrate paid checkout. Never use live Razorpay keys.
3. Start PostgreSQL and confirm the connected database name before running migrations or any setup that writes data. Do not use a database containing records you need to preserve. For database setup and migration steps, see the [setup guide](./docs/SETUP_GUIDE.md).
4. Start the app with `npm run dev`. Open `http://localhost:5173`; the API uses `http://localhost:3000` by default.
5. Confirm the API is reachable at `http://localhost:3000/api/health`. Ensure the existing database schema supports the current app before beginning account and event flows.

## Account access

- **Student:** use an existing verified local student account, or register through the public sign-up flow and complete email verification. Public sign-up always assigns the `STUDENT` role.
- **Organizer:** sign in with an organizer account provisioned for the local database. There is no public organizer sign-up or role selector. For an isolated demo database only, the repository includes a guarded, additive demo seed that upserts a demo organizer, students, events, and registrations. It generates a local-only credential file; no password is committed or documented.

The demo seed is optional and is not needed when suitable accounts and events already exist. To use it, first create and migrate a dedicated local `campusconnect_demo` database using the [setup guide](./docs/SETUP_GUIDE.md), then set the root `.env` `DATABASE_URL` to that database. The seed accepts only local PostgreSQL hosts and the database names `campusconnect_demo` or `campusconnect_test`; it also requires explicit, matching flags. In PowerShell, run:

```powershell
$env:DEMO_SEED_ENABLED = "true"
$env:DEMO_SEED_DATABASE_NAME = "campusconnect_demo"
npm run db:seed:demo -w apps/api
Remove-Item Env:DEMO_SEED_ENABLED
Remove-Item Env:DEMO_SEED_DATABASE_NAME
```

The seed upserts demo-only users and fixtures without deleting records. On first success it writes a randomly generated password to `.demo-credentials.local.json` at the repository root. Read it locally and privately to sign in; never publish or share it. If the database contains data you need to preserve, use an already provisioned organizer account instead of running the seed.

## Demonstration sequence

### 1. Organizer signs in

1. Open **Log in** and sign in with the existing organizer account.
2. Open the organizer dashboard.

**Show:** Organizer access is tied to the account role. Public student registration does not let users choose the organizer role.

### 2. Create and publish an event

1. Choose **Create event**.
2. Enter a title, description, category, venue, and future start time. Set capacity to a small number (for example, 20). Add venue coordinates if you want to show the map.
3. Save the event as a draft, then use **Publish** from the dashboard.

**Show:** Draft/published state, editable event details, public visibility after publishing, and the organizer's cancellation controls.

### 3. Student discovers the free event

1. Log out and sign in with the verified student account.
2. Open **Discover Events**, find the new event, and open its details.

**Show:** Search/listing, event details, venue/directions, and remaining seats for a capacity-limited event.

### 4. Student registers for the free event

1. Choose **Register** on the free event.
2. Open **My registrations** and confirm it appears.
3. Open the notification centre to show the registration confirmation.

**Show:** Duplicate registration is prevented, and the available-seat count updates after registration.

### 5. Student pays for a paid event with Razorpay Test Mode

1. Log out and sign in to the organizer account again. Create and publish a second event with a modest INR ticket price.
2. Log out and return to the verified student account. Open the paid event and choose **Pay and register**.
3. Complete checkout using Razorpay's official Test Mode payment details. Never use a real payment instrument.
4. Confirm the successful registration in **My registrations** and the registration notification in the notification centre.

**Show:** The API creates the order, verifies the payment signature and captured status, and prevents duplicate fulfillment. If checkout is not configured, skip this step; do not enable live payments to complete the demo.

See [docs/payments-setup.md](./docs/payments-setup.md) for Test Mode setup and permitted test scenarios. The app does not issue refunds; any refund after cancellation must be arranged manually.

### 6. Organizer views attendees

1. Log out and sign in to the organizer account.
2. In the dashboard, open **Attendees** for the free and paid events.

**Show:** Registration type/status, totals, and available capacity. The attendee list is restricted to the event's organizer.

### 7. Organizer cancels an event

1. From the dashboard, choose **Cancel Event** for an event with student registrations.
2. Confirm cancellation.

**Show:** The event is marked cancelled, new registrations are closed, existing registration records are preserved, and cancellation notification records are created for attendees. The UI explains that CampusConnect does not issue refunds.

### 8. Student receives the cancellation notification

1. Log out and sign in to the student account that registered for the cancelled event.
2. Open the notification centre and show the event cancellation message.
3. Open the cancelled event details to show the cancelled state and closed registration control.

**Show:** Registration and cancellation notifications are visible to the affected student. Delivery is in-app; email or push delivery is optional and requires separate configuration.

## Optional screens

- Open `/about`, `/how-it-works`, and `/faq` for project context.
- Open the notification preferences page to show optional browser push and reminders.
- Use the map only where coordinates are set and network access permits map tiles to load.

## Demonstration boundaries

- Use Razorpay Test Mode only. Do not enable live payments.
- Use a dedicated local database or records prepared for demonstration. Do not seed or alter a database whose existing data must be preserved.
- Do not run migrations as part of the presentation without confirming the target database and obtaining approval from its owner.
- SMTP, browser push, WhatsApp reminders, and map tiles depend on optional settings or external services; the core demo does not require those integrations.
- Automated PostgreSQL integration suites are separate from this walkthrough and require the dedicated local `campusconnect_test` database.
