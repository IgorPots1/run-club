'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [checkingUser, setCheckingUser] = useState(true)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    let isMounted = true

    async function checkUser() {
      try {
        const { data, error } = await supabase.auth.getUser()

        if (!isMounted) return

        if (error) {
          setAuthError('Не удалось проверить сессию')
          return
        }

        if (data.user) {
          router.push('/dashboard')
          return
        }
      } catch {
        if (isMounted) {
          setAuthError('Не удалось проверить сессию')
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

      router.push('/dashboard')
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

  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pb-8 pt-10 sm:min-h-screen sm:items-center sm:p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
        <h1 className="text-xl font-semibold">Войти</h1>
        {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
        <div>
          <label htmlFor="email" className="block text-sm mb-1">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
            className="min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm mb-1">Пароль</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            className="min-h-11 w-full rounded-lg border px-3 py-2"
          />
        </div>
        <button type="submit" disabled={loading} className="min-h-11 w-full rounded-lg bg-black px-4 py-2 text-white">
          {loading ? '...' : 'Войти'}
        </button>
        <p className="break-words text-sm text-gray-600">
          Нет аккаунта? <Link href="/register" className="underline">Регистрация</Link>
        </p>
        {message && <p className="text-sm">{message}</p>}
      </form>
    </main>
  )
}
