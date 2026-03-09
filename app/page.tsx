'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    async function redirectUser() {
      const user = await getBootstrapUser()
      router.push(user ? '/dashboard' : '/login')
    }

    void redirectUser()
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      Loading...
    </main>
  )
}
