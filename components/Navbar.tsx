'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export default function Navbar() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
    router.push('/login')
  }

  if (!user) return null

  return (
    <header className="border-b px-6 py-3">
      <div className="flex items-center justify-between">
        <nav className="flex items-center gap-6">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/runs">Runs</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/challenges">Challenges</Link>
          <Link href="/feed">Feed</Link>
          <Link href="/profile">Profile</Link>
        </nav>
        <button onClick={handleLogout}>Logout</button>
      </div>
    </header>
  )
}
