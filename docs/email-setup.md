# Email setup and verification

This project supports a secure email-verification flow and password recovery via SMTP. Email delivery is optional for local development, but the verification gate remains enforced for all sign-ins unless the account has been verified.

## Required environment variables

Add the SMTP settings to the repository-root `.env` file. The app treats all SMTP variables as a single unit: either all are configured together or the server falls back to the safe local-development behavior.

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=campusconnect
SMTP_PASSWORD=replace-me
SMTP_FROM=CampusConnect <no-reply@example.com>
```

The application reads these values from the root-level `.env` file. The API validates that `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` are configured together.

## Local development behavior

For local work, the API supports a localhost-safe fallback when:

- `NODE_ENV` is `development` or `test`
- `FRONTEND_ORIGIN` points to `localhost`, `127.0.0.1`, or `::1`
- SMTP is not configured

In that case, the app logs the verification or reset URL locally instead of sending a real email. This is safe for local testing only and should not be treated as production email delivery.

For live demos or a real environment, configure SMTP and use a real inbox. Do not rely on the development log path in production.

## Verification flow

When a user signs up, the account is created as unverified. The API generates a secure verification token (stored as a hash), emails the user, and returns a generic success response telling them to check their inbox.

The verification email contains a link back to the frontend verification route. Once the user opens the link, the frontend strips the token from the URL and sends it to `/api/auth/verify-email`.

If the token is valid and unexpired, the API marks the user as verified and allows the user to log in normally. If the token is missing, expired, or already consumed, the API returns a generic invalid-or-expired message.

The resend-verification endpoint follows the same safe pattern: a valid unverified account receives another verification email, but the response stays generic to avoid account enumeration.

## Password recovery flow

The forgot-password route accepts an email and responds generically when an account exists or not. If the address matches a user, the API generates a one-time reset token, hashes it before storing it, and sends a reset email with a frontend reset URL.

Password-reset tokens expire after a fixed window and are consumed atomically. Resetting a password also invalidates the user's existing sessions, which prevents stale authenticated tokens from remaining active.

## SMTP troubleshooting

### The verification or reset email never arrives

- Make sure all five SMTP variables are present in `.env`.
- Confirm the provider port and security mode match the SMTP service (`587` with `SMTP_SECURE=false` is common for STARTTLS; `465` with `SMTP_SECURE=true` is common for implicit TLS).
- Check whether the account requires an app password instead of the normal password.
- Verify that `SMTP_FROM` is set to a valid sender address for your provider.
- Confirm that the API environment is not using a localhost-only fallback by mistake.

### The API says the email delivery is not configured

This usually means the app is running in a localhost-safe development mode without configured SMTP, or the root `.env` is missing the required SMTP values. In local development, this is expected if you intentionally do not configure SMTP.

### The app logs a local fallback URL instead of sending email

This is the dev/test safety behavior. It indicates the server is in a safe local environment where a real provider is not configured.

### The account reports "EMAIL_NOT_VERIFIED" during login

The user must complete the verification step before signing in. Use the resend-verification endpoint to send a fresh verification email.

## Safe usage notes

- Never commit `.env` or share its contents.
- Do not send real emails during automated tests.
- Never use the local log fallback as a production delivery method.
- Keep verification and reset token handling generic to avoid leaking account state.
- If you are enabling public email delivery, verify the SMTP provider settings and audit the dependency posture before going live.
