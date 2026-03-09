'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBootstrapUser } from '@/lib/auth'

export default function Home() {
  const router = useRouter()
  const [targetPath, setTargetPath] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function redirectUser() {
      const user = await getBootstrapUser()
      const nextPath = user ? '/dashboard' : '/login'

      if (!isMounted) return

      setTargetPath(nextPath)
      router.replace(nextPath)
    }

    void redirectUser()

    return () => {
      isMounted = false
    }
  }, [router])

  if (targetPath) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-gray-600">Переходим...</p>
          <Link href={targetPath} className="mt-3 inline-block text-sm underline">
            Открыть страницу
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      Loading...
    </main>
  )
}
