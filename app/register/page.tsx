'use client'

import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import { upsertProfile } from '@/lib/profiles'
import { supabase } from '../../lib/supabase'

function getAuthErrorMessage(message: string) {
  const normalized = message.toLowerCase()

  if (normalized.includes('user already registered')) return 'Пользователь с таким email уже существует'
  if (normalized.includes('password should be at least')) return 'Пароль должен быть не короче 6 символов'
  if (normalized.includes('invalid email')) return 'Введите корректный email'

  return 'Не удалось создать аккаунт. Попробуйте еще раз.'
}

function getAuthCallbackUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || window.location.origin
  return new URL('/auth/callback', appUrl).toString()
}

export default function RegisterPage() {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [checkingUser, setCheckingUser] = useState(true)
  const [loading, setLoading] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function checkUser() {
      try {
        if (!isMounted) return

        const user = await getBootstrapUser()

        if (user) {
          setRedirecting(true)
          router.replace('/auth/continue')
        }
      } finally {
        if (isMounted) {
          setCheckingUser(false)
        }
      }
    }

    void checkUser()

    return () => {
      isMounted = false
    }
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return

    const normalizedFirstName = firstName.trim()
    const normalizedLastName = lastName.trim()
    const normalizedName = [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ')
    const normalizedNickname = nickname.trim()
    const normalizedEmail = email.trim()
    if (!normalizedFirstName) {
      setError('Введите имя')
      return
    }

    if (!normalizedLastName) {
      setError('Введите фамилию')
      return
    }

    if (!normalizedNickname) {
      setError('Введите никнейм')
      return
    }

    if (!normalizedEmail) {
      setError('Введите email')
      return
    }

    if (!password) {
      setError('Введите пароль')
      return
    }

    if (password.length < 6) {
      setError('Пароль должен быть не короче 6 символов')
      return
    }

    setError('')
    setSuccess('')
    setLoading(true)

    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: getAuthCallbackUrl(),
          data: {
            first_name: normalizedFirstName,
            last_name: normalizedLastName,
            name: normalizedName,
            nickname: normalizedNickname,
          },
        },
      })

      if (error) {
        setError(getAuthErrorMessage(error.message))
        return
      }

      if (!data.user?.id) {
        setError('Не удалось создать профиль')
        return
      }

      const { error: profileError } = await upsertProfile({
        id: data.user.id,
        email: data.user.email ?? normalizedEmail,
        first_name: normalizedFirstName,
        last_name: normalizedLastName,
        name: normalizedName,
        nickname: normalizedNickname,
      })

      if (profileError) {
        setError('Аккаунт создан, но профиль не сохранился')
        return
      }

      if (data.session) {
        setRedirecting(true)
        router.replace('/auth/continue')
        return
      }

      setSuccess('Аккаунт создан. Войдите, чтобы продолжить.')
    } catch {
      setError('Не удалось создать аккаунт. Попробуйте еще раз.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingUser) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        Загрузка...
      </main>
    )
  }

  if (redirecting) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <p className="app-text-secondary text-sm">Переходим в приложение...</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pb-8 pt-10 sm:min-h-screen sm:items-center sm:p-4">
      <form onSubmit={handleSubmit} className="app-card w-full max-w-sm space-y-4 rounded-2xl border p-4 shadow-sm sm:p-5">
        <h1 className="app-text-primary text-xl font-semibold">Создать аккаунт</h1>
        <div>
          <label htmlFor="first-name" className="app-text-secondary block text-sm mb-1">Имя</label>
          <input
            id="first-name"
            type="text"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value)
              setError('')
              setSuccess('')
            }}
            required
            disabled={loading}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="last-name" className="app-text-secondary block text-sm mb-1">Фамилия</label>
          <input
            id="last-name"
            type="text"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value)
              setError('')
              setSuccess('')
            }}
            required
            disabled={loading}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="nickname" className="app-text-secondary block text-sm mb-1">Никнейм</label>
          <input
            id="nickname"
            type="text"
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value)
              setError('')
              setSuccess('')
            }}
            required
            disabled={loading}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="email" className="app-text-secondary block text-sm mb-1">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError('')
              setSuccess('')
            }}
            required
            disabled={loading}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="app-text-secondary block text-sm mb-1">Пароль</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
                setSuccess('')
              }}
              required
              disabled={loading}
              className="app-input min-h-11 w-full rounded-lg border px-3 py-2 pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              className="app-text-secondary absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center"
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="app-text-secondary mt-1 text-sm">Минимум 6 символов.</p>
        </div>
        <button type="submit" disabled={loading} className="app-button-primary min-h-11 w-full rounded-lg px-4 py-2">
          {loading ? 'Создаем аккаунт...' : 'Зарегистрироваться'}
        </button>
        <p className="app-text-secondary break-words text-sm">
          Уже есть аккаунт? <Link href="/login" className="no-underline">Войти</Link>
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success ? (
          <div className="space-y-2 text-sm">
            <p>{success}</p>
            <Link href="/login" className="inline-block no-underline">
              Перейти ко входу
            </Link>
          </div>
        ) : null}
      </form>
    </main>
  )
}
