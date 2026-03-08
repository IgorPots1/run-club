'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Challenge = {
  id: string
  title: string
  description: string | null
  start_date: string
  end_date: string
  status: 'active' | 'completed'
}

type ChallengesSectionProps = {
  showTitle?: boolean
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function getStatusLabel(status: Challenge['status']) {
  return status === 'completed' ? 'Завершен' : 'Активный'
}

export default function ChallengesSection({ showTitle = true }: ChallengesSectionProps) {
  const router = useRouter()
  const [items, setItems] = useState<Challenge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadData() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      const { data: challengesData, error } = await supabase
        .from('challenges')
        .select('id, title, description, start_date, end_date, status')
        .order('start_date', { ascending: true })

      if (error) {
        setError('Не удалось загрузить челленджи')
        setLoading(false)
        return
      }

      setItems((challengesData as Challenge[]) ?? [])
      setLoading(false)
    }

    void loadData()
  }, [router])

  return (
    <div className="p-4">
      {showTitle ? <h1 className="mb-4 text-2xl font-bold">Челленджи</h1> : null}
      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
          <div className="space-y-3 mb-4">
            {items.length === 0 ? (
              <div className="mt-10 text-center text-gray-500">
                <p>No challenges yet</p>
              </div>
            ) : (
              items.map((item) => (
                <div key={item.id} className="rounded-xl border bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold">{item.title}</h2>
                      {item.description ? (
                        <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                      ) : null}
                    </div>

                    <div className="text-right">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                          item.status === 'completed'
                            ? 'bg-gray-100 text-gray-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {getStatusLabel(item.status)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 space-y-1 text-sm text-gray-600">
                    <p>Старт: {formatDate(item.start_date)}</p>
                    <p>Финиш: {formatDate(item.end_date)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
