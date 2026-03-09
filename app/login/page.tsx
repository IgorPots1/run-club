'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
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
          router.replace('/dashboard')
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

    const normalizedEmail = email.trim()
    if (!normalizedEmail || !password) {
      setMessage('Введите email и пароль')
      return
    }

    setMessage('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })

      if (error) {
        setMessage(error.message)
        return
      }

      setRedirecting(true)
      router.replace('/dashboard')
    } catch {
      setMessage('Не удалось войти. Попробуйте еще раз.')
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
        <h1 className="app-text-primary text-xl font-semibold">Войти</h1>
        <div>
          <label htmlFor="email" className="app-text-secondary block text-sm mb-1">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="app-text-secondary block text-sm mb-1">Пароль</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className="app-input min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <button type="submit" disabled={loading} className="app-button-primary min-h-11 w-full rounded-lg px-4 py-2">
          {loading ? '...' : 'Войти'}
        </button>
        <p className="app-text-secondary break-words text-sm">
          Нет аккаунта? <Link href="/register" className="underline">Регистрация</Link>
        </p>
        {message && <p className="text-sm">{message}</p>}
      </form>
    </main>
  )
}
