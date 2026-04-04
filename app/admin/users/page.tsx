import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { getProfileDisplayName } from '@/lib/profiles'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { blockUserAppAccess, unblockUserAppAccess } from './actions'

type ProfileRow = {
  id: string
  name?: string | null
  nickname?: string | null
  email?: string | null
  role?: string | null
  app_access_status?: string | null
  created_at?: string | null
}

function isProfileRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getOptionalProfileString(
  record: Record<string, unknown>,
  key: keyof Omit<ProfileRow, 'id'>
): string | null | undefined {
  const value = record[key]
  return typeof value === 'string' || value == null ? value : undefined
}

function normalizeProfiles(data: unknown): ProfileRow[] {
  if (!Array.isArray(data)) return []

  return data.flatMap((row) => {
    if (!isProfileRecord(row) || typeof row.id !== 'string') {
      return []
    }

    return [
      {
        id: row.id,
        name: getOptionalProfileString(row, 'name'),
        nickname: getOptionalProfileString(row, 'nickname'),
        email: getOptionalProfileString(row, 'email'),
        role: getOptionalProfileString(row, 'role'),
        app_access_status: getOptionalProfileString(row, 'app_access_status'),
        created_at: getOptionalProfileString(row, 'created_at'),
      },
    ]
  })
}

function formatNullableValue(value: string | number | null | undefined) {
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

function isMissingProfileColumnError(
  error: { code?: string | null; message?: string | null },
  column: 'nickname' | 'email' | 'created_at'
) {
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    Boolean(error.message?.includes(`profiles.${column}`)) ||
    Boolean(error.message?.includes(`'${column}' column of 'profiles'`))
  )
}

export default async function AdminUsersPage() {
  const { user } = await requireAdmin()
  const supabase = createSupabaseAdminClient()
  let includesNickname = true
  let includesEmail = true
  let includesCreatedAt = true

  const runProfilesQuery = async () => {
    const fields = ['id', 'name', 'nickname', 'email', 'role', 'app_access_status', 'created_at']
    const activeFields = fields.filter((field) => {
      if (field === 'nickname') return includesNickname
      if (field === 'email') return includesEmail
      if (field === 'created_at') return includesCreatedAt
      return true
    })

    return supabase
      .from('profiles')
      .select(activeFields.join(', '))
      .order(includesCreatedAt ? 'created_at' : 'id', { ascending: false })
  }

  let result = await runProfilesQuery()

  while (result.error) {
    if (includesCreatedAt && isMissingProfileColumnError(result.error, 'created_at')) {
      includesCreatedAt = false
      result = await runProfilesQuery()
      continue
    }

    if (includesNickname && isMissingProfileColumnError(result.error, 'nickname')) {
      includesNickname = false
      result = await runProfilesQuery()
      continue
    }

    if (includesEmail && isMissingProfileColumnError(result.error, 'email')) {
      includesEmail = false
      result = await runProfilesQuery()
      continue
    }

    throw result.error
  }

  const profiles = normalizeProfiles(result.data)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="app-text-primary text-2xl font-bold">Пользователи</h1>
        <p className="app-text-secondary text-sm">Управление доступом в приложение и ручными действиями по аккаунтам.</p>
      </div>

      {profiles.length === 0 ? (
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <p className="app-text-secondary text-sm">Пользователи не найдены.</p>
        </div>
      ) : (
        <div className="app-card overflow-x-auto rounded-2xl border shadow-sm">
          <table className="min-w-full border-collapse">
            <thead className="app-surface-muted">
              <tr className="text-left">
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">ID</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Имя</th>
                {includesNickname ? <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Никнейм</th> : null}
                {includesEmail ? <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Email</th> : null}
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Роль</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Доступ</th>
                {includesCreatedAt ? <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Создан</th> : null}
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Действия</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => {
                const isCurrentAdmin = profile.id === user.id
                const appAccessStatus = profile.app_access_status ?? 'active'

                return (
                  <tr key={profile.id} className="border-b align-top">
                    <td className="app-text-secondary px-4 py-3 text-sm">{profile.id}</td>
                    <td className="px-4 py-3">
                      {getProfileDisplayName(profile, profile.id)}
                    </td>
                    {includesNickname ? (
                      <td className="px-4 py-3">{formatNullableValue(profile.nickname)}</td>
                    ) : null}
                    {includesEmail ? (
                      <td className="px-4 py-3">{formatNullableValue(profile.email)}</td>
                    ) : null}
                    <td className="px-4 py-3">{formatRole(profile.role)}</td>
                    <td className="px-4 py-3">{formatAppAccessStatus(appAccessStatus)}</td>
                    {includesCreatedAt ? (
                      <td className="app-text-secondary px-4 py-3 text-sm">{formatNullableValue(profile.created_at)}</td>
                    ) : null}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2">
                        <Link
                          href={`/admin/users/${profile.id}`}
                          className="app-button-secondary rounded-2xl border px-4 py-2 text-center text-sm font-medium shadow-sm"
                        >
                          Открыть
                        </Link>
                        {isCurrentAdmin ? (
                          <div className="space-y-1">
                            <p className="app-text-secondary text-sm">Текущий аккаунт</p>
                            <button
                              type="button"
                              disabled
                              className="app-button-secondary cursor-not-allowed rounded-2xl border px-4 py-2 text-sm font-medium opacity-50"
                            >
                              {appAccessStatus === 'blocked' ? 'Разблокировать' : 'Заблокировать'}
                            </button>
                          </div>
                        ) : appAccessStatus === 'blocked' ? (
                          <form action={unblockUserAppAccess}>
                            <input type="hidden" name="user_id" value={profile.id} />
                            <button type="submit" className="app-button-secondary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm">
                              Разблокировать
                            </button>
                          </form>
                        ) : (
                          <form action={blockUserAppAccess}>
                            <input type="hidden" name="user_id" value={profile.id} />
                            <button type="submit" className="app-button-secondary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm">
                              Заблокировать
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
