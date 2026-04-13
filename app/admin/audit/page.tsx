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

function formatDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatAction(value: string) {
  if (value === 'auth.signup') return 'Регистрация'
  if (value === 'auth.email_confirmed') return 'Подтверждение email'
  if (value === 'app_access.block') return 'Блокировка доступа'
  if (value === 'app_access.unblock') return 'Разблокировка доступа'
  if (value === 'challenge.create') return 'Создание челленджа'
  if (value === 'challenge.update') return 'Обновление челленджа'
  if (value === 'challenge_access.grant') return 'Выдача доступа к челленджу'
  if (value === 'challenge_access.revoke') return 'Отзыв доступа к челленджу'
  if (value === 'xp.adjust') return 'Ручная корректировка XP'
  return value
}

function formatEntityType(value: string) {
  if (value === 'profile') return 'Профиль'
  if (value === 'challenge') return 'Челлендж'
  if (value === 'challenge_access') return 'Доступ к челленджу'
  return value
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
      <div className="space-y-2">
        <h1 className="app-text-primary text-2xl font-bold">Журнал действий</h1>
        <p className="app-text-secondary text-sm">Последние административные действия, записанные на сервере.</p>
      </div>

      {rows.length === 0 ? (
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <p className="app-text-secondary text-sm">Записей в журнале пока нет.</p>
        </div>
      ) : (
        <div className="app-card overflow-x-auto rounded-2xl border shadow-sm">
          <table className="min-w-full border-collapse">
            <thead className="app-surface-muted">
              <tr className="text-left">
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Когда</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">ID администратора</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Действие</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Тип сущности</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">ID сущности</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">До</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">После</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b align-top">
                  <td className="app-text-primary px-4 py-3 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="break-all">{row.actor_user_id}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatAction(row.action)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{formatEntityType(row.entity_type)}</td>
                  <td className="px-4 py-3">
                    <span className="break-all">{row.entity_id ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <pre className="app-surface-muted max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded-2xl p-3 text-xs">
                      {formatJson(row.payload_before)}
                    </pre>
                  </td>
                  <td className="px-4 py-3">
                    <pre className="app-surface-muted max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded-2xl p-3 text-xs">
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
