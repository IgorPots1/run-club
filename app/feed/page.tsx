'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import RunLikeControl from '@/components/RunLikeControl'
import { loadRunLikesSummary, subscribeToRunLikes, toggleRunLike } from '@/lib/run-likes'
import { supabase } from '../../lib/supabase'
import { getLevelFromXP } from '../../lib/xp'

type RunWithProfile = {
  run_id: string
  user_id: string
  title: string
  distance_km: number
  xp: number
  created_at: string
  displayName: string
  avatar_url: string | null
  totalXp: number
  likesCount: number
  likedByMe: boolean
}

export default function FeedPage() {
  const router = useRouter()
  const [items, setItems] = useState<RunWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [pendingRunIds, setPendingRunIds] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        setCurrentUserId(user?.id ?? null)

        const [
          { data: runs, error: runsError },
          { data: profiles, error: profilesError },
          { likesByRunId, likedRunIds },
        ] = await Promise.all([
          supabase
            .from('runs')
            .select('id, user_id, title, distance_km, xp, created_at')
            .order('created_at', { ascending: false }),
          supabase.from('profiles').select('id, name, email, avatar_url'),
          loadRunLikesSummary(user?.id ?? null),
        ])

        if (runsError || profilesError) {
          setError('Не удалось загрузить ленту')
          setLoading(false)
          return
        }

        const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
        const totalXpByUser: Record<string, number> = {}

        for (const run of runs ?? []) {
          totalXpByUser[run.user_id] = (totalXpByUser[run.user_id] ?? 0) + run.xp
        }

        const list = (runs ?? []).map((run) => {
          const p = profileById[run.user_id]
          const displayName = p?.name?.trim() || p?.email || '—'
          const avatar_url = p?.avatar_url ?? null
          const totalXp = totalXpByUser[run.user_id] ?? 0
          return {
            run_id: run.id,
            user_id: run.user_id,
            title: run.title || 'Тренировка',
            distance_km: run.distance_km,
            xp: run.xp,
            created_at: run.created_at,
            displayName,
            avatar_url,
            totalXp,
            likesCount: likesByRunId[run.id] ?? 0,
            likedByMe: likedRunIds.has(run.id),
          }
        })

        setItems(list)
      } catch {
        setError('Не удалось загрузить ленту')
      }
      setLoading(false)
    }

    void load()
    const unsubscribe = subscribeToRunLikes(() => {
      void load()
    })

    return () => {
      unsubscribe()
    }
  }, [])

  async function handleLikeToggle(runId: string) {
    if (!currentUserId) {
      router.push('/login')
      return
    }

    if (pendingRunIds.includes(runId)) return

    const currentItem = items.find((item) => item.run_id === runId)
    if (!currentItem) return

    const wasLiked = currentItem.likedByMe
    const previousItems = items

    setError('')
    setPendingRunIds((prev) => [...prev, runId])
    setItems((prev) =>
      prev.map((item) =>
        item.run_id === runId
          ? {
              ...item,
              likedByMe: !wasLiked,
              likesCount: Math.max(0, item.likesCount + (wasLiked ? -1 : 1)),
            }
          : item
      )
    )

    const { error: likeError } = await toggleRunLike(runId, currentUserId, wasLiked)

    if (likeError) {
      setItems(previousItems)
      setError('Не удалось обновить лайк')
    }

    setPendingRunIds((prev) => prev.filter((id) => id !== runId))
  }

  if (loading) return <main className="min-h-screen p-4">Загрузка...</main>

  return (
    <main className="min-h-screen">
      <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Лента</h1>
      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
      <div className="max-w-md space-y-3 mb-4">
        {items.length === 0 ? (
          <div className="mt-10 text-center text-gray-500">
            <p>Пока нет тренировок</p>
            <Link href="/runs" className="inline-block mt-4 px-4 py-2 rounded-lg border">
              Добавить тренировку
            </Link>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.run_id} className="border rounded-xl p-4 shadow-sm bg-white">
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-gray-600 mt-1">
                {item.displayName} · Уровень {getLevelFromXP(item.totalXp).level}
              </p>
              <p className="text-sm mt-1">🏃 {item.distance_km} км</p>
              <p className="text-sm mt-1">+{item.xp} XP</p>
              <p className="text-sm text-gray-500 mt-1">
                {new Date(item.created_at).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long'
                })}
              </p>
              <RunLikeControl
                likesCount={item.likesCount}
                likedByMe={item.likedByMe}
                pending={pendingRunIds.includes(item.run_id)}
                onToggle={() => handleLikeToggle(item.run_id)}
              />
            </div>
          ))
        )}
      </div>
      </div>
    </main>
  )
}
