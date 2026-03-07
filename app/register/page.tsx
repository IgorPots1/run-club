'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [checkingUser, setCheckingUser] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        router.push('/dashboard')
        return
      }
      setCheckingUser(false)
    })
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) {
      setLoading(false)
      setError(error.message)
      return
    }
    setLoading(false)
    setSuccess('Account created. Please check your email and confirm your address before logging in.')
  }

  if (checkingUser) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        Loading...
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Register</h1>
        <div>
          <label htmlFor="email" className="block text-sm mb-1">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm mb-1">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <button type="submit" disabled={loading} className="w-full bg-black text-white rounded py-2">
          {loading ? '...' : 'Register'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm">{success}</p>}
      </form>
    </main>
  )
}
