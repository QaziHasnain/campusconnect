import { type FormEvent, useEffect, useState } from 'react'
import {
  ApiError,
  getWhatsAppPreferences,
  updateWhatsAppPreferences,
} from '../lib/api'
import './WhatsAppPreferences.css'

export function WhatsAppPreferences() {
  const [phoneNumber, setPhoneNumber] = useState('')
  const [consent, setConsent] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getWhatsAppPreferences()
      .then((preferences) => {
        if (cancelled) return
        setPhoneNumber(preferences.phoneNumber ?? '')
        setConsent(preferences.consent)
        setEnabled(preferences.enabled)
      })
      .catch((requestError: unknown) => {
        if (cancelled) return
        setError(
          requestError instanceof ApiError && requestError.status === 401
            ? 'Sign in again to manage WhatsApp reminders.'
            : 'Could not load your WhatsApp preferences. Please try again.',
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setIsSaving(true)
    try {
      const preferences = await updateWhatsAppPreferences(phoneNumber, consent)
      setPhoneNumber(preferences.phoneNumber ?? '')
      setConsent(preferences.consent)
      setEnabled(preferences.enabled)
      setNotice(
        preferences.consent
          ? 'Your reminder preferences have been saved.'
          : 'WhatsApp reminder consent has been withdrawn.',
      )
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Could not save your WhatsApp preferences. Please try again.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="whatsapp-preferences" aria-labelledby="whatsapp-preferences-title">
      <div className="whatsapp-preferences-heading">
        <div>
          <span className="eyebrow section-eyebrow">OPTIONAL EVENT UPDATES</span>
          <h2 id="whatsapp-preferences-title">WhatsApp reminders</h2>
        </div>
        <span className={`whatsapp-status${enabled ? ' is-enabled' : ''}`} role="status">
          {enabled ? 'Service enabled' : 'Service currently disabled'}
        </span>
      </div>
      <p className="whatsapp-preferences-description">
        Add an international phone number to receive transactional reminders for events you register
        for. Registration alone never opts you in. Reminders are sent 24 hours and 1 hour before an
        event when those times are still ahead.
      </p>

      {isLoading ? (
        <p className="whatsapp-feedback" role="status">Loading your WhatsApp preferences…</p>
      ) : (
        <form className="whatsapp-preferences-form" onSubmit={(event) => void savePreferences(event)}>
          <label className="whatsapp-phone-field" htmlFor="whatsapp-phone-number">
            Phone number
            <input
              id="whatsapp-phone-number"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+15551234567"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              aria-describedby="whatsapp-phone-help"
            />
          </label>
          <small id="whatsapp-phone-help">
            Include your country calling code. The number is visible only to you and is not shown
            publicly.
          </small>
          <label className="whatsapp-consent-field">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I agree to receive transactional WhatsApp reminders for events I register for. I can
              withdraw consent at any time.
            </span>
          </label>
          {consent && (
            <p className="whatsapp-consent-active" role="status">
              Consent is active. Uncheck this box and save to withdraw consent.
            </p>
          )}
          {error && <p className="whatsapp-feedback is-error" role="alert">{error}</p>}
          {notice && <p className="whatsapp-feedback is-success" role="status">{notice}</p>}
          <button className="button button-primary" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save WhatsApp preferences'}
          </button>
        </form>
      )}
    </section>
  )
}
