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
        <Link href="/admin/users" className="text-sm underline">
          Back to users
        </Link>
        <h1 className="text-2xl font-semibold">User admin</h1>
        <p className="text-sm text-gray-600">Review profile details and adjust XP manually.</p>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="rounded border p-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-medium">ID</dt>
            <dd className="break-all">{profile.id}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Name</dt>
            <dd>{formatNullableValue(profile.name)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Nickname</dt>
            <dd>{formatNullableValue(profile.nickname)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Email</dt>
            <dd className="break-all">{formatNullableValue(profile.email)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Role</dt>
            <dd>{formatNullableValue(profile.role)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">App access status</dt>
            <dd>{formatNullableValue(profile.app_access_status)}</dd>
          </div>
          <div>
            <dt className="text-sm font-medium">Total XP</dt>
            <dd>{formatNullableValue(profile.total_xp ?? 0)}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3 rounded border p-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Manual XP adjustment</h2>
          <p className="text-sm text-gray-600">Use a positive number to add XP. Use a negative number to remove XP.</p>
        </div>

        {isCurrentAdmin ? (
          <div className="rounded border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            You cannot adjust your own XP from this page.
          </div>
        ) : (
          <form action={adjustUserXpAction} className="space-y-4">
            <input type="hidden" name="user_id" value={profile.id} />
            <div className="space-y-1">
              <label htmlFor="delta_xp" className="block text-sm font-medium">
                XP delta
              </label>
              <input
                id="delta_xp"
                name="delta_xp"
                type="number"
                step="1"
                required
                className="w-full rounded border px-3 py-2"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="reason" className="block text-sm font-medium">
                Reason
              </label>
              <textarea
                id="reason"
                name="reason"
                rows={3}
                required
                className="w-full rounded border px-3 py-2"
              />
            </div>
            <button type="submit" className="rounded border px-3 py-2 text-sm">
              Apply XP adjustment
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
