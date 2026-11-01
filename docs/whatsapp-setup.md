# WhatsApp event reminder setup

CampusConnect can send opt-in, transactional event reminders through Meta's official WhatsApp
Business Cloud API or Twilio's official WhatsApp API. The integration is disabled unless
`WHATSAPP_ENABLED=true`; phone numbers and consent are private student preferences and are not
added to public event or registration responses. Registration by itself never grants messaging
consent.

## 1. Configure a provider

Set `WHATSAPP_PROVIDER` to `meta` (the default) or `twilio`. Configure only the selected provider.
Keep `WHATSAPP_ENABLED=false` until credentials, a valid approved template, and a safe test plan are
ready. A Sandbox join message and test message are real WhatsApp messages; do not send either
without explicit approval. Twilio notes Sandbox message usage is billed at standard WhatsApp rates.

### Twilio WhatsApp Sandbox

The Sandbox is for testing only, not production. Twilio's current Sandbox documentation says to
activate it in the legacy Console. After signing in at the official [Twilio Console](https://console.twilio.com/),
open **Messaging → Try it out → WhatsApp**. If that entry is unavailable, use Twilio's official
[Sandbox page](https://www.twilio.com/console/sms/whatsapp/sandbox). Review the billing terms before
confirming activation; do not select a paid plan or purchase a sender.

On the Sandbox page:

1. Activate the Sandbox only after confirming you want to proceed. Twilio displays the Sandbox
   sender number and a unique `join <code>` message. The shared Sandbox number is
   `+14155238886`.
2. To join, scan the displayed QR code or manually send the displayed join message from your
   personal WhatsApp account to the sender number. Twilio replies to confirm. This sends a real
   message; do it yourself only when ready. Each recipient must join, and the Sandbox membership
   expires after three days.
3. Find the pre-approved **Appointment Reminders** content template and its Content SID in the
   Sandbox instructions. The Sandbox does not allow custom templates. CampusConnect maps template
   variable `1` to the event date and `2` to the event time; this template does not include the
   event name, venue, or details link.
4. Find the Account SID and Auth Token in the Twilio Console account credentials area. Treat the
   Auth Token like a password; enter it only in the API's secret environment, never in chat,
   screenshots, source control, or terminal commands/output.

Twilio's pre-approved Sandbox templates and their behavior are documented in the official
[WhatsApp Sandbox guide](https://www.twilio.com/docs/whatsapp/sandbox). Outside a recipient's
24-hour customer-service window, the Sandbox permits only these approved templates.

| Variable | Required when Twilio is selected and enabled | Description |
|---|---:|---|
| `WHATSAPP_TWILIO_ACCOUNT_SID` | Yes | Twilio Account SID (`AC...`) |
| `WHATSAPP_TWILIO_AUTH_TOKEN` | Yes | Private Twilio Auth Token |
| `WHATSAPP_TWILIO_FROM` | Yes | Sandbox sender number, e.g. `+14155238886` |
| `WHATSAPP_TWILIO_CONTENT_SID` | Yes | Content SID (`HX...`) of the pre-approved Appointment Reminders template |

### Meta WhatsApp Business Cloud API

1. Create or select a Meta business portfolio and a Meta developer app with the WhatsApp product.
2. Complete the business and phone-number setup in WhatsApp Manager. Record the **Phone Number ID**
   shown for the sending number (not the displayed phone number).
3. Generate a production system-user access token with the `whatsapp_business_messaging` permission.
   Store it only in the API/worker environment or a secret manager. Do not put it in a `VITE_*`
   variable, browser storage, source control, or logs.
4. Choose the supported Graph API version for the app and use that exact version in
   `WHATSAPP_GRAPH_API_VERSION`.
5. Add and verify recipient phone numbers in the Meta test setup before production testing.

## 2. Submit an approved template

In WhatsApp Manager, create a **Utility** template using a name and language that match
`WHATSAPP_TEMPLATE_NAME` and `WHATSAPP_TEMPLATE_LANGUAGE`. For example:

```text
Hi {{1}}, a reminder that you registered for {{2}}.
It starts on {{3}} at {{4}} (UTC) at {{5}}.
Event details: {{6}}
You can withdraw reminder consent in your CampusConnect account.
```

Provide realistic example values for all six body parameters when submitting. The API fills them in
as student name, event name, event date, event time, venue, and the published event details URL.
Submit the template and wait for Meta to approve it before enabling sending. Do not use a free-form
business-initiated message in place of this approved template.

If the approved template name, language, category, or parameter layout differs, update the API
configuration and template together. The API sends the six parameters in this documented order.

## 3. Configure the API and worker

Set the selected provider's variables in the server environment (the repository `.env.example`
contains blank values):

| Variable | Required when enabled | Description |
|---|---:|---|
| `WHATSAPP_ENABLED` | Yes | Must be `true` to schedule/send; defaults to `false` |
| `WHATSAPP_PROVIDER` | No | `meta` (default) or `twilio` |
| `WHATSAPP_ACCESS_TOKEN` | Yes for Meta | Private Meta system-user access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes for Meta | Meta ID of the sending phone number |
| `WHATSAPP_GRAPH_API_VERSION` | Yes for Meta | Configured version, for example `vXX.X` |
| `WHATSAPP_TEMPLATE_NAME` | Yes for Meta | Name of the approved Utility template |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Yes for Meta | Approved template language code |
| `WHATSAPP_TWILIO_ACCOUNT_SID` | Yes for Twilio | Private Twilio account identifier |
| `WHATSAPP_TWILIO_AUTH_TOKEN` | Yes for Twilio | Private Twilio Auth Token |
| `WHATSAPP_TWILIO_FROM` | Yes for Twilio | Sandbox sender number in E.164 format |
| `WHATSAPP_TWILIO_CONTENT_SID` | Yes for Twilio | SID of the approved Sandbox template |
| `WHATSAPP_REMINDER_OFFSETS_HOURS` | No | Two distinct positive hour offsets; defaults to `24,1` |

The API and worker both read the repository-root `.env` locally. Keep credentials out of screenshots,
frontend configuration, and logs. Do not copy secrets into `.env` without approval. Apply migrations
to the intended database with:

```sh
npm run db:migrate -w apps/api
```

Start the API and the worker in separate terminals:

```sh
npm run dev -w apps/api
npm run worker -w apps/api
```

For a compiled deployment, build first, then run `npm run start:worker -w apps/api` as a separate
process from the API. The worker polls every 30 seconds. Run only one deployment per independent
database environment as normal operations practice; PostgreSQL row locking permits multiple worker
instances to safely claim different pending reminders.

## 4. Student consent and delivery

Students manage their international phone number and explicit opt-in under **My registrations**.
The checkbox starts unchecked. Students can save a phone number without opting in and withdraw
consent at any time. The API normalizes supported international formats to E.164 and stores consent
timestamps. A worker rechecks consent, phone number, event publication, and event start time just
before sending.

Only future reminder times are scheduled. An interval whose time has already passed is skipped;
events that have started, are unpublished, or no longer have an eligible consenting student are not
sent. Reminders are uniquely keyed by registration and offset. Provider temporary errors use a
bounded retry schedule; permanent failures are not retried indefinitely. Provider calls use HTTPS,
a 15-second timeout, and sanitized error codes.

An external provider cannot participate in a PostgreSQL transaction. A process crash in the narrow
interval after a provider accepts a message but before the worker records its message ID can
therefore leave delivery outcome uncertain; the worker's processing lease allows recovery, but
cannot provide an end-to-end exactly-once guarantee across the provider and PostgreSQL.
Successfully recorded `SENT` reminders are never claimed again.

## 5. Safe local testing

Automated tests mock the Meta and Twilio HTTP APIs and never send messages. Unit tests run with:

```sh
npm test
```

PostgreSQL integration tests are opt-in. Before enabling them, create and migrate a dedicated local
database named `campusconnect_test`, point the root `.env` `DATABASE_URL` at that database, and
confirm the database name and local host. The integration test guards reject other database names.
Do not use the demo, development, shared, or production database. Do not reset, drop, or reseed a
database to run tests.

Keep `WHATSAPP_ENABLED=false` in test environments. The API suite does not require Meta credentials,
and no automated test makes a real provider request.
