'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import type { User } from '@supabase/supabase-js'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
      if (!user) router.push('/login')
    })
  }, [router])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return <main className="min-h-screen flex items-center justify-center p-4">Loading...</main>
  if (!user) return null

  return (
    <main className="min-h-screen p-4">
      <h1 className="text-xl font-semibold mb-2">Dashboard</h1>
      <p className="text-sm mb-4">{user.email}</p>
      <nav className="flex flex-col gap-2 mb-4">
        <Link href="/profile" className="text-blue-600 underline">Profile</Link>
        <Link href="/leaderboard" className="text-blue-600 underline">Leaderboard</Link>
        <Link href="/login" className="text-blue-600 underline">Login</Link>
      </nav>
      <button onClick={handleLogout} className="border rounded px-3 py-2">
        Logout
      </button>
    </main>
  )
}
