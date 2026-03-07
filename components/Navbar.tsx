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
    <nav className="flex items-center justify-between border-b p-4">
      <div className="flex gap-4">
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/runs">Runs</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/challenges">Challenges</Link>
          <Link href="/feed">Feed</Link>
          <Link href="/profile">Profile</Link>
      </div>
      <button onClick={handleLogout}>Logout</button>
    </nav>
  )
}
