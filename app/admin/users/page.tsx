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
      <div>
        <h1 className="text-2xl font-semibold">Users admin</h1>
        <p className="text-sm text-gray-600">Manage participant app access.</p>
      </div>

      {profiles.length === 0 ? (
        <p>No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Name</th>
                {includesNickname ? <th className="px-3 py-2 font-medium">Nickname</th> : null}
                {includesEmail ? <th className="px-3 py-2 font-medium">Email</th> : null}
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">App access</th>
                {includesCreatedAt ? <th className="px-3 py-2 font-medium">Created</th> : null}
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => {
                const isCurrentAdmin = profile.id === user.id
                const appAccessStatus = profile.app_access_status ?? 'active'

                return (
                  <tr key={profile.id} className="border-b align-top">
                    <td className="px-3 py-2">{profile.id}</td>
                    <td className="px-3 py-2">
                      {getProfileDisplayName(profile, profile.id)}
                    </td>
                    {includesNickname ? (
                      <td className="px-3 py-2">{formatNullableValue(profile.nickname)}</td>
                    ) : null}
                    {includesEmail ? (
                      <td className="px-3 py-2">{formatNullableValue(profile.email)}</td>
                    ) : null}
                    <td className="px-3 py-2">{formatNullableValue(profile.role)}</td>
                    <td className="px-3 py-2">{formatNullableValue(appAccessStatus)}</td>
                    {includesCreatedAt ? (
                      <td className="px-3 py-2">{formatNullableValue(profile.created_at)}</td>
                    ) : null}
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-2">
                        <Link href={`/admin/users/${profile.id}`} className="rounded border px-3 py-2 text-center text-sm">
                          Manage
                        </Link>
                        {isCurrentAdmin ? (
                          <div className="space-y-1">
                            <p className="text-sm text-gray-500">Current account</p>
                            <button
                              type="button"
                              disabled
                              className="cursor-not-allowed rounded border px-3 py-2 text-sm opacity-50"
                            >
                              {appAccessStatus === 'blocked' ? 'Unblock' : 'Block'}
                            </button>
                          </div>
                        ) : appAccessStatus === 'blocked' ? (
                          <form action={unblockUserAppAccess}>
                            <input type="hidden" name="user_id" value={profile.id} />
                            <button type="submit" className="rounded border px-3 py-2 text-sm">
                              Unblock
                            </button>
                          </form>
                        ) : (
                          <form action={blockUserAppAccess}>
                            <input type="hidden" name="user_id" value={profile.id} />
                            <button type="submit" className="rounded border px-3 py-2 text-sm">
                              Block
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
