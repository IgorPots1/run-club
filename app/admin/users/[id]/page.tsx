import Link from 'next/link'
import { notFound } from 'next/navigation'
import { adjustUserXpAction } from '../actions'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type AdminUserDetailPageProps = {
  params: Promise<{
    id: string
  }>
  searchParams?: Promise<{
    error?: string
  }>
}

type ProfileDetailsRow = {
  id: string
  name?: string | null
  nickname?: string | null
  email?: string | null
  role?: string | null
  app_access_status?: string | null
  total_xp?: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getOptionalString(record: Record<string, unknown>, key: keyof Omit<ProfileDetailsRow, 'id' | 'total_xp'>) {
  const value = record[key]
  return typeof value === 'string' || value == null ? value : undefined
}

function getOptionalNumber(record: Record<string, unknown>, key: 'total_xp') {
  const value = record[key]
  return typeof value === 'number' || value == null ? value : undefined
}

function normalizeProfileDetails(data: unknown): ProfileDetailsRow | null {
  if (!isRecord(data) || typeof data.id !== 'string') {
    return null
  }

  return {
    id: data.id,
    name: getOptionalString(data, 'name'),
    nickname: getOptionalString(data, 'nickname'),
    email: getOptionalString(data, 'email'),
    role: getOptionalString(data, 'role'),
    app_access_status: getOptionalString(data, 'app_access_status'),
    total_xp: getOptionalNumber(data, 'total_xp'),
  }
}

function formatNullableValue(value: number | string | null | undefined) {
  return value == null || value === '' ? '—' : String(value)
}

function formatRole(value: string | null | undefined) {
  if (value === 'admin') return 'Админ'
  if (value === 'coach') return 'Тренер'
  if (value === 'user') return 'Участник'
  return formatNullableValue(value)
}

function formatAppAccessStatus(value: string | null | undefined) {
  if (value === 'active') return 'Активен'
  if (value === 'blocked') return 'Заблокирован'
  return formatNullableValue(value)
}

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: AdminUserDetailPageProps) {
  const [{ id }, resolvedSearchParams, adminContext] = await Promise.all([
    params,
    searchParams ? searchParams : Promise.resolve(undefined),
    requireAdmin(),
  ])
  const error = resolvedSearchParams?.error?.trim() || ''
  const isCurrentAdmin = adminContext.user.id === id
  const supabase = createSupabaseAdminClient()
  const result = await supabase
    .from('profiles')
    .select('id, name, nickname, email, role, app_access_status, total_xp')
    .eq('id', id)
    .maybeSingle()

  if (result.error) {
    throw result.error
  }

  const profile = normalizeProfileDetails(result.data)

  if (!profile) {
    notFound()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/admin/users"
          className="app-text-secondary text-sm transition-opacity hover:opacity-70"
        >
          Назад к пользователям
        </Link>
        <h1 className="app-text-primary text-2xl font-bold">Профиль пользователя</h1>
        <p className="app-text-secondary text-sm">Просмотр данных профиля и ручная корректировка XP.</p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="app-card rounded-2xl border p-4 shadow-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="app-text-secondary text-sm">ID</dt>
            <dd className="app-text-primary mt-1 break-all font-medium">{profile.id}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Имя</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatNullableValue(profile.name)}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Никнейм</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatNullableValue(profile.nickname)}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Email</dt>
            <dd className="app-text-primary mt-1 break-all font-medium">{formatNullableValue(profile.email)}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Роль</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatRole(profile.role)}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Статус доступа</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatAppAccessStatus(profile.app_access_status)}</dd>
          </div>
          <div>
            <dt className="app-text-secondary text-sm">Всего XP</dt>
            <dd className="app-text-primary mt-1 font-medium">{formatNullableValue(profile.total_xp ?? 0)}</dd>
          </div>
        </dl>
      </section>

      <section className="app-card space-y-3 rounded-2xl border p-4 shadow-sm">
        <div className="space-y-1">
          <h2 className="app-text-primary text-lg font-semibold">Ручная корректировка XP</h2>
          <p className="app-text-secondary text-sm">Используйте положительное число, чтобы добавить XP. Отрицательное число уменьшит XP.</p>
        </div>

        {isCurrentAdmin ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            Нельзя менять свой собственный XP с этой страницы.
          </div>
        ) : (
          <form action={adjustUserXpAction} className="space-y-4">
            <input type="hidden" name="user_id" value={profile.id} />
            <div className="space-y-1">
              <label htmlFor="delta_xp" className="app-text-secondary block text-sm">
                Изменение XP
              </label>
              <input
                id="delta_xp"
                name="delta_xp"
                type="number"
                step="1"
                required
                className="app-input w-full rounded-2xl border px-3 py-2"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="reason" className="app-text-secondary block text-sm">
                Причина
              </label>
              <textarea
                id="reason"
                name="reason"
                rows={3}
                required
                className="app-input w-full rounded-2xl border px-3 py-2"
              />
            </div>
            <button type="submit" className="app-button-primary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm">
              Применить изменение
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
