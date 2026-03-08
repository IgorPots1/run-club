'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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

type RunLike = {
  run_id: string
  user_id: string
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
      const {
        data: { user },
      } = await supabase.auth.getUser()

      setCurrentUserId(user?.id ?? null)

      const [{ data: runs, error: runsError }, { data: profiles, error: profilesError }, { data: likes, error: likesError }] =
        await Promise.all([
          supabase
            .from('runs')
            .select('id, user_id, title, distance_km, xp, created_at')
            .order('created_at', { ascending: false }),
          supabase.from('profiles').select('id, name, email, avatar_url'),
          supabase.from('run_likes').select('run_id, user_id'),
        ])

      if (runsError || profilesError || likesError) {
        setError('Не удалось загрузить ленту')
        setLoading(false)
        return
      }

      const profileById = Object.fromEntries((profiles ?? []).map((p) => [p.id, p]))
      const totalXpByUser: Record<string, number> = {}
      const likesByRunId: Record<string, number> = {}
      const likedRunIds = new Set<string>()

      for (const run of runs ?? []) {
        totalXpByUser[run.user_id] = (totalXpByUser[run.user_id] ?? 0) + run.xp
      }

      for (const like of (likes as RunLike[] | null) ?? []) {
        likesByRunId[like.run_id] = (likesByRunId[like.run_id] ?? 0) + 1
        if (like.user_id === user?.id) {
          likedRunIds.add(like.run_id)
        }
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
      setLoading(false)
    }
    load()
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

    const { error: likeError } = wasLiked
      ? await supabase.from('run_likes').delete().eq('run_id', runId).eq('user_id', currentUserId)
      : await supabase.from('run_likes').insert({ run_id: runId, user_id: currentUserId })

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
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500">Лайки: {item.likesCount}</p>
                <button
                  type="button"
                  onClick={() => handleLikeToggle(item.run_id)}
                  disabled={pendingRunIds.includes(item.run_id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    item.likedByMe ? 'border-black bg-black text-white' : 'border-gray-300'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {pendingRunIds.includes(item.run_id)
                    ? '...'
                    : item.likedByMe
                      ? 'Убрать лайк'
                      : 'Лайк'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      </div>
    </main>
  )
}
