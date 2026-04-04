import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type AuditLogRow = {
  id: string
  actor_user_id: string
  action: string
  entity_type: string
  entity_id: string | null
  payload_before: Record<string, unknown>
  payload_after: Record<string, unknown>
  created_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function normalizeAuditLogRows(data: unknown): AuditLogRow[] {
  if (!Array.isArray(data)) {
    return []
  }

  return data.flatMap((item) => {
    if (!isRecord(item)) {
      return []
    }

    if (
      typeof item.id !== 'string' ||
      typeof item.actor_user_id !== 'string' ||
      typeof item.action !== 'string' ||
      typeof item.entity_type !== 'string' ||
      typeof item.created_at !== 'string'
    ) {
      return []
    }

    return [
      {
        id: item.id,
        actor_user_id: item.actor_user_id,
        action: item.action,
        entity_type: item.entity_type,
        entity_id: typeof item.entity_id === 'string' ? item.entity_id : null,
        payload_before: normalizeJsonObject(item.payload_before),
        payload_after: normalizeJsonObject(item.payload_after),
        created_at: item.created_at,
      },
    ]
  })
}

function formatJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2)
}

export default async function AdminAuditPage() {
  await requireAdmin()

  const supabase = createSupabaseAdminClient()
  const result = await supabase
    .from('admin_audit_log')
    .select('id, actor_user_id, action, entity_type, entity_id, payload_before, payload_after, created_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (result.error) {
    throw result.error
  }

  const rows = normalizeAuditLogRows(result.data)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin audit log</h1>
        <p className="text-sm text-gray-600">Recent admin actions recorded by the server.</p>
      </div>

      {rows.length === 0 ? (
        <p>No audit entries yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Actor user ID</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Entity type</th>
                <th className="px-3 py-2 font-medium">Entity ID</th>
                <th className="px-3 py-2 font-medium">Before</th>
                <th className="px-3 py-2 font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{row.created_at}</td>
                  <td className="px-3 py-2">
                    <span className="break-all">{row.actor_user_id}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.action}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.entity_type}</td>
                  <td className="px-3 py-2">
                    <span className="break-all">{row.entity_id ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs">
                      {formatJson(row.payload_before)}
                    </pre>
                  </td>
                  <td className="px-3 py-2">
                    <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-3 text-xs">
                      {formatJson(row.payload_after)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
