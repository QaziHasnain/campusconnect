# Razorpay test-mode setup

CampusConnect uses Razorpay Standard Checkout for paid event tickets in INR. The API creates every
order from the event's integer-paise price, verifies the Checkout HMAC signature against the order ID
stored for the signed-in student, retrieves the payment from Razorpay, and creates the existing event
registration only after the payment is captured. Razorpay orders reserve an available seat for about
six hours, with a short buffer beyond Razorpay's default order expiry; event row locks and database
transactions protect capacity and duplicate registrations.

No live payments are enabled. Do not configure live credentials.

The additive Prisma migration is created but has not been applied. No database writes or migrations
were performed for this implementation. Before any future migration or database-backed test write,
verify PostgreSQL returns `current_database() = campusconnect_test` on the same connection. Never
apply it to the existing `CampusConnect` or `campusconnect_demo` databases.

## Environment

Add these values to the repository-root `.env` for local development. Keep all private values on the
API server and out of source control:

```dotenv
RAZORPAY_MODE=test
RAZORPAY_KEY_ID=<Razorpay test key ID>
RAZORPAY_KEY_SECRET=<Razorpay test key secret>
RAZORPAY_WEBHOOK_SECRET=<webhook signing secret>
```

The application starts when credentials are absent. Payment checkout remains unavailable and the
student sees a configuration message. The API returns only the public key ID when all test
credentials are present and the key ID has the `rzp_test_` prefix. Live mode or live key IDs disable
payments.

## Razorpay Dashboard

1. Sign in to Razorpay and use **Test Mode**. Obtain the test Key ID and Key Secret from the test
   API keys page.
2. Set `RAZORPAY_MODE=test`, `RAZORPAY_KEY_ID`, and `RAZORPAY_KEY_SECRET` in the API's local
   environment. Never put either key secret in a `VITE_` variable.
3. In **Account & Settings → Webhooks**, add a webhook for
   `https://<reachable-test-host>/api/payments/webhook`. For local end-to-end webhook testing, the
   API must be reachable through a trusted HTTPS tunnel; do not expose a production service or use
   live mode for this purpose.
4. Subscribe to `payment.captured` and `payment.failed`. Generate a webhook secret and set the same
   value as `RAZORPAY_WEBHOOK_SECRET`.
5. Save the webhook and use Razorpay's dashboard test delivery to confirm it reaches the endpoint.
   The API verifies the signature over the original raw request body and records the Razorpay event
   ID for idempotent processing.

Checkout verification also fetches the payment from Razorpay and checks its captured status, amount,
currency, and stored order ID. The webhook is the server-to-server recovery path if the browser closes
after payment.

## Local verification

1. Create a paid event in the organizer form with a price in INR, a published status, and optional
   capacity. The backend stores the price as integer paise.
2. Sign in as a verified student, open the event, and choose **Pay and register**.
3. Complete Checkout using Razorpay's official test payment details. Use the test card, UPI, and
   failure scenarios listed in Razorpay's current Test Mode documentation; never enter a real
   payment instrument.
4. A successful captured test payment should show **Registered** and appear in **My registrations**.
   A failed or dismissed attempt shows its state and can be retried.
5. Confirm invalid signatures, non-captured payments, duplicate webhook deliveries, and capacity
   races through the automated mocked tests. Those tests make no Razorpay network requests.

No real payment has been made or tested as part of this implementation.

## Future live-mode migration

Live mode is intentionally rejected by the current API. Enabling live payments later requires a
separate security and operational review, new live credentials stored only in the backend secret
manager, a separately configured live webhook, refund/support procedures, and updated documentation.
Do not change `RAZORPAY_MODE` to `live` in this version.
