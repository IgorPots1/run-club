'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      router.push(user ? '/dashboard' : '/login')
    })
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      Loading...
    </main>
  )
}
