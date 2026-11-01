import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from './useAuth'
import {
  ApiError,
  apiRequest,
  authUserResponseSchema,
  requestPasswordReset,
  resetPassword,
} from '../lib/api'
import './AuthPages.css'

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254))

const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128, 'Password is too long'),
})

const registrationInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100, 'Name must be 100 characters or fewer'),
  email: emailSchema,
  password: z
    .string()
    .min(8, 'Use at least 8 characters for your password')
    .max(128, 'Password must be 128 characters or fewer'),
})

const passwordResetRequestInputSchema = z.object({ email: emailSchema })

const passwordResetInputSchema = z
  .object({
    password: z
      .string()
      .min(8, 'Use at least 8 characters for your password')
      .max(128, 'Password must be 128 characters or fewer'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })

function getApiErrorMessage(error: unknown, action: 'login' | 'register') {
  if (error instanceof ApiError) {
    if (error.status === 400) return 'Please review the information and try again.'
    if (action === 'login' && error.status === 401) return 'The email or password is incorrect.'
    if (action === 'register' && error.status === 409) {
      return 'An account with this email already exists. Try signing in instead.'
    }
    if (error.status >= 500) return 'The service is temporarily unavailable. Please try again.'
    return 'We could not complete your request. Please try again.'
  }

  return 'Unable to reach CampusConnect. Check your connection and try again.'
}

function AuthPageFrame({
  title,
  description,
  children,
  alternate,
  alternatePath,
  alternateLabel,
}: {
  title: string
  description: string
  children: ReactNode
  alternate: string
  alternatePath: string
  alternateLabel: string
}) {
  return (
    <main className="auth-main">
        <section className="auth-card" aria-labelledby="auth-title">
          <span className="eyebrow section-eyebrow">CAMPUS LIFE, CONNECTED</span>
          <h1 id="auth-title">{title}</h1>
          <p className="auth-description">{description}</p>
          {children}
          <p className="auth-alternate">
            {alternate} <Link to={alternatePath}>{alternateLabel}</Link>
          </p>
        </section>
        <p className="auth-footnote">Your campus. Your events. One place.</p>
    </main>
  )
}

function InitializingMessage() {
  return (
    <p className="auth-notice" role="status">
      Checking your sign-in status…
    </p>
  )
}

export function LoginPage() {
  const { user, isChecking, initializationError, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isChecking && user) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const formData = new FormData(event.currentTarget)
    const parsed = loginInputSchema.safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check your information.')
      return
    }

    setIsSubmitting(true)
    try {
      await apiRequest('/api/auth/login', authUserResponseSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      const currentUser = await refreshUser()
      navigate(currentUser.role === 'ORGANIZER' ? '/organizer' : '/', { replace: true })
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'login'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthPageFrame
      title="Welcome back."
      description="Sign in to stay connected with what’s happening on campus."
      alternate="New to CampusConnect?"
      alternatePath="/register"
      alternateLabel="Create an account"
    >
      {isChecking && <InitializingMessage />}
      {initializationError && (
        <p className="auth-error" role="alert">{initializationError}</p>
      )}
      {searchParams.get('passwordReset') === '1' && (
        <p className="auth-notice" role="status">
          Your password has been updated. Sign in with your new password.
        </p>
      )}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="login-email">Email address</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@college.edu"
          required
          maxLength={254}
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          required
          maxLength={128}
        />
        <Link className="auth-inline-link" to="/forgot-password">
          Forgot password?
        </Link>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={isChecking || isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
          {!isSubmitting && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>
    </AuthPageFrame>
  )
}

export function ForgotPasswordPage() {
  const { user, isChecking } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isChecking && user) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)

    const formData = new FormData(event.currentTarget)
    const parsed = passwordResetRequestInputSchema.safeParse({
      email: formData.get('email'),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await requestPasswordReset(parsed.data.email)
      setMessage(response.message)
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 429
          ? 'Too many requests. Please wait before trying again.'
          : requestError instanceof ApiError && requestError.status >= 500
            ? 'The service is temporarily unavailable. Please try again.'
            : 'Unable to reach CampusConnect. Check your connection and try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthPageFrame
      title="Reset your password."
      description="Enter the email address linked to your account."
      alternate="Remember your password?"
      alternatePath="/login"
      alternateLabel="Sign in"
    >
      {isChecking && <InitializingMessage />}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="forgot-password-email">Email address</label>
        <input
          id="forgot-password-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@college.edu"
          required
          maxLength={254}
        />
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-notice" role="status">{message}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={isChecking || isSubmitting}>
          {isSubmitting ? 'Preparing reset…' : 'Request reset link'}
          {!isSubmitting && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>
    </AuthPageFrame>
  )
}

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const token = searchParams.get('token') ?? ''

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!token) {
      setError('This reset link is invalid or has expired. Request a new link.')
      return
    }

    const formData = new FormData(event.currentTarget)
    const parsed = passwordResetInputSchema.safeParse({
      password: formData.get('password'),
      confirmPassword: formData.get('confirmPassword'),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check your new password.')
      return
    }

    setIsSubmitting(true)
    try {
      await resetPassword(token, parsed.data.password)
      navigate('/login?passwordReset=1', { replace: true })
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.status === 400
          ? 'This reset link is invalid or has expired. Request a new link.'
          : requestError instanceof ApiError && requestError.status === 429
            ? 'Too many attempts. Please wait before trying again.'
            : requestError instanceof ApiError && requestError.status >= 500
              ? 'The service is temporarily unavailable. Please try again.'
              : 'Unable to reach CampusConnect. Check your connection and try again.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthPageFrame
      title="Choose a new password."
      description="Use at least 8 characters. Your reset link can only be used once."
      alternate="Need another reset link?"
      alternatePath="/forgot-password"
      alternateLabel="Request one"
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="reset-password">New password</label>
        <input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
        />
        <label htmlFor="reset-password-confirm">Confirm new password</label>
        <input
          id="reset-password-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          maxLength={128}
        />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Updating password…' : 'Update password'}
          {!isSubmitting && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>
    </AuthPageFrame>
  )
}

export function RegistrationPage() {
  const { user, isChecking, initializationError, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isChecking && user) return <Navigate to="/" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const formData = new FormData(event.currentTarget)
    const parsed = registrationInputSchema.safeParse({
      name: formData.get('name'),
      email: formData.get('email'),
      password: formData.get('password'),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check your information.')
      return
    }

    setIsSubmitting(true)
    try {
      await apiRequest('/api/auth/register', authUserResponseSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      })
      const currentUser = await refreshUser()
      navigate(currentUser.role === 'ORGANIZER' ? '/organizer' : '/', { replace: true })
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'register'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthPageFrame
      title="Find your campus community."
      description="Create an account to make the most of every moment on campus."
      alternate="Already have an account?"
      alternatePath="/login"
      alternateLabel="Sign in"
    >
      {isChecking && <InitializingMessage />}
      {initializationError && (
        <p className="auth-error" role="alert">{initializationError}</p>
      )}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="register-name">Full name</label>
        <input
          id="register-name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Your name"
          required
          maxLength={100}
        />
        <label htmlFor="register-email">Email address</label>
        <input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@college.edu"
          required
          maxLength={254}
        />
        <label htmlFor="register-password">Password</label>
        <input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
          minLength={8}
          maxLength={128}
        />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={isChecking || isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
          {!isSubmitting && <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </form>
    </AuthPageFrame>
  )
}
