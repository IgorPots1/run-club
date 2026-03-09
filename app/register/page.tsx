'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'
import { supabase } from '../../lib/supabase'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      setError('Введите email и пароль')
      return
    }

    setError('')
    setSuccess('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      })

      if (error) {
        setError(error.message)
        return
      }

      setSuccess('Аккаунт создан. Проверьте почту и подтвердите адрес перед входом.')
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
        <p className="text-sm text-gray-600">Переходим в приложение...</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pb-8 pt-10 sm:min-h-screen sm:items-center sm:p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
        <h1 className="text-xl font-semibold">Регистрация</h1>
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
          {loading ? '...' : 'Зарегистрироваться'}
        </button>
        <p className="break-words text-sm text-gray-600">
          Уже есть аккаунт? <Link href="/login" className="underline">Войти</Link>
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm">{success}</p>}
      </form>
    </main>
  )
}
