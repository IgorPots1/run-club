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
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-sm text-gray-600 mt-1">{user.email}</p>
          </div>
          <button onClick={handleLogout} className="border rounded px-3 py-2">
            Logout
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/runs" className="border rounded p-4">
            <h2 className="font-medium">Runs</h2>
          </Link>
          <Link href="/leaderboard" className="border rounded p-4">
            <h2 className="font-medium">Leaderboard</h2>
          </Link>
          <Link href="/feed" className="border rounded p-4">
            <h2 className="font-medium">Feed</h2>
          </Link>
          <Link href="/profile" className="border rounded p-4">
            <h2 className="font-medium">Profile</h2>
          </Link>
          <Link href="/challenges" className="border rounded p-4 sm:col-span-2">
            <h2 className="font-medium">Challenges</h2>
          </Link>
        </div>
      </div>
    </main>
  )
}
