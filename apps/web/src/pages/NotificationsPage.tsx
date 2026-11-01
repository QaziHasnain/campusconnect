import { useEffect, useState } from 'react'
import { Bell, Check, CheckCheck, Clock3, LoaderCircle, Settings2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  getNotificationPreferences,
  getNotificationPushConfig,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removePushSubscription,
  savePushSubscription,
  updateNotificationPreferences,
} from '../lib/api'
import type { NotificationItem, NotificationPreferences } from '../lib/api'
import './NotificationsPage.css'

const preferenceLabels: Array<{
  key: keyof NotificationPreferences
  title: string
  description: string
}> = [
  {
    key: 'inAppEnabled',
    title: 'In-app notifications',
    description: 'Keep a notification history in CampusConnect.',
  },
  {
    key: 'pushEnabled',
    title: 'Browser notifications',
    description: 'Receive a private browser alert on subscribed devices.',
  },
  {
    key: 'eventRemindersEnabled',
    title: 'Event reminders',
    description: 'Get reminders 24 hours and 1 hour before registered events.',
  },
  {
    key: 'eventUpdatesEnabled',
    title: 'Event updates',
    description: 'Be notified when an event you registered for changes.',
  },
]

function isBrowserPushSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const decoded = window.atob(padded)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}

function displayError(error: unknown) {
  if (error instanceof ApiError && error.status === 503) {
    return 'Browser push is not configured on this CampusConnect server.'
  }
  if (error instanceof ApiError && error.status >= 500) {
    return 'The notification service is temporarily unavailable. Please try again.'
  }
  return 'We could not update notifications. Check your connection and try again.'
}

export function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [vapidPublicKey, setVapidPublicKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false)
  const [savingPreference, setSavingPreference] = useState<keyof NotificationPreferences | null>(null)
  const [isUpdatingPush, setIsUpdatingPush] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([
      getNotifications(),
      getNotificationPreferences(),
      isBrowserPushSupported() ? getNotificationPushConfig() : Promise.resolve(null),
    ])
      .then(([notificationResponse, preferenceResponse, pushConfig]) => {
        if (!active) return
        setNotifications(notificationResponse.notifications)
        setUnreadCount(notificationResponse.unreadCount)
        setNextCursor(notificationResponse.nextCursor)
        setPreferences(preferenceResponse.preferences)
        setVapidPublicKey(pushConfig?.vapidPublicKey ?? null)
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(displayError(error))
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function loadMore() {
    if (!nextCursor || isLoadingMore) return
    setIsLoadingMore(true)
    setErrorMessage(null)
    try {
      const result = await getNotifications(nextCursor)
      setNotifications((current) => [...current, ...result.notifications])
      setNextCursor(result.nextCursor)
      setUnreadCount(result.unreadCount)
    } catch (error) {
      setErrorMessage(displayError(error))
    } finally {
      setIsLoadingMore(false)
    }
  }

  async function handleRead(notification: NotificationItem) {
    if (notification.readAt) return
    try {
      const result = await markNotificationRead(notification.id)
      setNotifications((current) =>
        current.map((item) => item.id === notification.id ? result.notification : item),
      )
      setUnreadCount((count) => Math.max(0, count - 1))
      window.dispatchEvent(new Event('campusconnect:notifications-updated'))
    } catch (error) {
      setErrorMessage(displayError(error))
    }
  }

  async function handleReadAll() {
    setIsMarkingAllRead(true)
    setErrorMessage(null)
    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((item) => ({ ...item, readAt })))
      setUnreadCount(0)
      setStatusMessage('All notifications marked as read.')
      window.dispatchEvent(new Event('campusconnect:notifications-updated'))
    } catch (error) {
      setErrorMessage(displayError(error))
    } finally {
      setIsMarkingAllRead(false)
    }
  }

  async function handlePreferenceChange(
    key: keyof NotificationPreferences,
    checked: boolean,
  ) {
    if (!preferences) return
    const updated = { ...preferences, [key]: checked }
    setSavingPreference(key)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const result = await updateNotificationPreferences(updated)
      setPreferences(result.preferences)
      if (key === 'inAppEnabled' && !checked) {
        setNotifications([])
        setUnreadCount(0)
      }
      if (key === 'inAppEnabled') {
        window.dispatchEvent(new Event('campusconnect:notifications-updated'))
      }
    } catch (error) {
      setErrorMessage(displayError(error))
    } finally {
      setSavingPreference(null)
    }
  }

  async function enableBrowserPush() {
    if (!isBrowserPushSupported()) return
    setIsUpdatingPush(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      if (!vapidPublicKey) {
        setErrorMessage('Browser push is not configured on this CampusConnect server.')
        return
      }
      const permission =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission()
      if (permission !== 'granted') {
        setErrorMessage(
          permission === 'denied'
            ? 'Browser notification permission is blocked. Change it in your browser site settings.'
            : 'Browser notification permission was not granted.',
        )
        return
      }

      const registration = await navigator.serviceWorker.register('/sw.js')
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(vapidPublicKey),
        }))
      await savePushSubscription(subscription.toJSON())
      if (!preferences) return
      const result = await updateNotificationPreferences({
        ...preferences,
        pushEnabled: true,
      })
      setPreferences(result.preferences)
      setStatusMessage('Browser notifications are enabled for this device.')
    } catch (error) {
      setErrorMessage(displayError(error))
    } finally {
      setIsUpdatingPush(false)
    }
  }

  async function disableBrowserPush() {
    if (!preferences) return
    setIsUpdatingPush(true)
    setErrorMessage(null)
    setStatusMessage(null)
    try {
      const result = await updateNotificationPreferences({
        ...preferences,
        pushEnabled: false,
      })
      setPreferences(result.preferences)
      if (isBrowserPushSupported()) {
        const registration = await navigator.serviceWorker.getRegistration()
        const subscription = await registration?.pushManager.getSubscription()
        if (subscription) {
          await removePushSubscription(subscription.endpoint)
          await subscription.unsubscribe()
        }
      }
      setStatusMessage('Browser notifications are disabled.')
    } catch (error) {
      setErrorMessage(displayError(error))
    } finally {
      setIsUpdatingPush(false)
    }
  }

  const browserPushSupported = isBrowserPushSupported()

  return (
    <main className="notifications-page section-wrap">
      <header className="notifications-heading">
        <div>
          <span className="eyebrow section-eyebrow"><Bell size={14} aria-hidden="true" /> YOUR UPDATES</span>
          <h1>Notifications</h1>
          <p>Event reminders and updates for your CampusConnect account.</p>
        </div>
        <div className="notifications-heading-actions">
          <Link className="notifications-settings-link" to="#notification-preferences">
            <Settings2 size={16} aria-hidden="true" /> Preferences
          </Link>
          <button
            className="notification-action-button"
            type="button"
            onClick={() => void handleReadAll()}
            disabled={unreadCount === 0 || isMarkingAllRead}
          >
            {isMarkingAllRead
              ? <LoaderCircle size={16} className="notification-spinner" aria-hidden="true" />
              : <CheckCheck size={16} aria-hidden="true" />}
            Mark all as read
          </button>
        </div>
      </header>

      {errorMessage && <p className="notification-message is-error" role="alert">{errorMessage}</p>}
      {statusMessage && <p className="notification-message is-success" role="status">{statusMessage}</p>}

      <section className="notification-history" aria-labelledby="notification-history-title">
        <div className="notification-section-heading">
          <div>
            <h2 id="notification-history-title">History</h2>
            <p>{unreadCount === 1 ? '1 unread notification' : `${unreadCount} unread notifications`}</p>
          </div>
          {unreadCount > 0 && <span className="notification-unread-pill">{unreadCount} new</span>}
        </div>

        {isLoading ? (
          <div className="notification-empty-state" role="status">
            <LoaderCircle className="notification-spinner" size={22} aria-hidden="true" />
            <span>Loading your notifications…</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="notification-empty-state">
            <Bell size={24} aria-hidden="true" />
            <strong>No notifications yet</strong>
            <span>Your event reminders and updates will appear here.</span>
          </div>
        ) : (
          <ol className="notification-list">
            {notifications.map((notification) => (
              <li
                className={`notification-item${notification.readAt ? '' : ' is-unread'}`}
                key={notification.id}
              >
                <span className="notification-item-icon" aria-hidden="true">
                  {notification.type === 'EVENT_REMINDER'
                    ? <Clock3 size={18} />
                    : <Bell size={18} />}
                </span>
                <Link
                  className="notification-item-content"
                  to={notification.relatedEventId
                    ? `/events/${encodeURIComponent(notification.relatedEventId)}`
                    : '/notifications'}
                  onClick={() => void handleRead(notification)}
                >
                  <span className="notification-item-title">{notification.title}</span>
                  <span className="notification-item-message">{notification.message}</span>
                  <time dateTime={notification.createdAt}>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(notification.createdAt))}
                  </time>
                </Link>
                {!notification.readAt && (
                  <button
                    className="notification-read-button"
                    type="button"
                    aria-label={`Mark ${notification.title} as read`}
                    onClick={() => void handleRead(notification)}
                  >
                    <Check size={16} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}

        {nextCursor && (
          <button
            className="notification-load-more"
            type="button"
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
          >
            {isLoadingMore && <LoaderCircle className="notification-spinner" size={16} aria-hidden="true" />}
            Load older notifications
          </button>
        )}
      </section>

      <section
        className="notification-preferences"
        id="notification-preferences"
        aria-labelledby="notification-preferences-title"
      >
        <div className="notification-section-heading">
          <div>
            <h2 id="notification-preferences-title">Preferences</h2>
            <p>Choose what CampusConnect can notify you about.</p>
          </div>
        </div>
        {preferences && (
          <div className="notification-preference-list">
            {preferenceLabels.map(({ key, title, description }) => {
              const isPush = key === 'pushEnabled'
              const unsupportedPush = isPush && !browserPushSupported
              const unconfiguredPush = isPush && browserPushSupported && !vapidPublicKey
              return (
                <div className="notification-preference-row" key={key}>
                  <div>
                    <strong>{title}</strong>
                    <span>{description}</span>
                    {unsupportedPush && (
                      <small className="notification-support-note">
                        Browser push is not supported in this browser or page context.
                      </small>
                    )}
                    {unconfiguredPush && (
                      <small className="notification-support-note">
                        Browser push has not been configured by the server.
                      </small>
                    )}
                  </div>
                  {isPush && browserPushSupported && vapidPublicKey ? (
                    preferences.pushEnabled ? (
                      <button
                        className="notification-toggle-action"
                        type="button"
                        onClick={() => void disableBrowserPush()}
                        disabled={isUpdatingPush}
                      >
                        {isUpdatingPush && <LoaderCircle className="notification-spinner" size={15} aria-hidden="true" />}
                        Disable
                      </button>
                    ) : (
                      <button
                        className="notification-toggle-action is-primary"
                        type="button"
                        onClick={() => void enableBrowserPush()}
                        disabled={isUpdatingPush}
                      >
                        {isUpdatingPush && <LoaderCircle className="notification-spinner" size={15} aria-hidden="true" />}
                        Enable
                      </button>
                    )
                  ) : (
                    <label className="notification-switch">
                      <span className="sr-only">{title}</span>
                      <input
                        type="checkbox"
                        checked={preferences[key]}
                        disabled={savingPreference === key || unsupportedPush || unconfiguredPush}
                        onChange={(event) => void handlePreferenceChange(key, event.target.checked)}
                      />
                      <span className="notification-switch-track" aria-hidden="true" />
                    </label>
                  )}
                  {savingPreference === key && (
                    <span className="sr-only" role="status">Saving {title.toLowerCase()} preference…</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {!browserPushSupported && (
          <p className="notification-preference-footnote">
            In-app notifications work independently of browser push.
          </p>
        )}
      </section>
    </main>
  )
}
