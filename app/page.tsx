'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    async function redirectUser() {
      try {
        const { data } = await supabase.auth.getUser()
        router.push(data.user ? '/dashboard' : '/login')
      } catch {
        router.push('/login')
      }
    }

    void redirectUser()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      Loading...
    </main>
  )
}
