import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

type ChallengeTemplateRow = {
  id: string
  title: string
  period_type: string | null
  goal_unit: string | null
  goal_target: number | null
  xp_reward: number | null
  created_at: string | null
}

function formatNullableValue(value: number | string | null | undefined) {
  return value == null || value === '' ? '—' : String(value)
}

function formatPeriodType(value: string | null | undefined) {
  if (value === 'lifetime') return 'Пожизненный'
  if (value === 'challenge') return 'По расписанию'
  if (value === 'weekly') return 'Еженедельный'
  if (value === 'monthly') return 'Ежемесячный'
  return formatNullableValue(value)
}

function formatGoalUnit(value: string | null | undefined) {
  if (value === 'distance_km') return 'Дистанция'
  if (value === 'run_count') return 'Количество тренировок'
  return formatNullableValue(value)
}

export default async function AdminChallengeTemplatesPage() {
  await requireAdmin()

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('challenge_templates')
    .select('id, title, period_type, goal_unit, goal_target, xp_reward, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  const templates = (data as ChallengeTemplateRow[] | null) ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h1 className="app-text-primary text-2xl font-bold">Шаблоны челленджей</h1>
          <p className="app-text-secondary text-sm">Переиспользуемые заготовки для быстрого создания челленджей.</p>
        </div>
        <Link
          href="/admin/challenge-templates/new"
          className="app-button-primary rounded-2xl border px-4 py-2 text-sm font-medium shadow-sm"
        >
          Новый шаблон
        </Link>
      </div>

      {templates.length === 0 ? (
        <div className="app-card rounded-2xl border p-4 shadow-sm">
          <p className="app-text-secondary text-sm">Шаблонов пока нет.</p>
        </div>
      ) : (
        <div className="app-card overflow-x-auto rounded-2xl border shadow-sm">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="app-surface-muted">
              <tr className="text-left">
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Название</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Тип</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Цель</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Значение</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">XP</th>
                <th className="app-text-secondary px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em]">Создан</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id} className="border-b align-top">
                  <td className="w-[280px] px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <Link
                        href={`/admin/challenge-templates/${template.id}/edit`}
                        className="app-text-primary font-semibold transition-opacity hover:opacity-70"
                      >
                        {template.title}
                      </Link>
                      <Link
                        href={`/admin/challenges/new?template_id=${encodeURIComponent(template.id)}`}
                        className="app-text-secondary text-sm transition-opacity hover:opacity-70"
                      >
                        Создать челлендж по шаблону
                      </Link>
                    </div>
                  </td>
                  <td className="w-[160px] px-4 py-3">{formatPeriodType(template.period_type)}</td>
                  <td className="w-[160px] px-4 py-3">{formatGoalUnit(template.goal_unit)}</td>
                  <td className="w-[120px] px-4 py-3">{formatNullableValue(template.goal_target)}</td>
                  <td className="w-[100px] px-4 py-3">{formatNullableValue(template.xp_reward)}</td>
                  <td className="app-text-secondary w-[170px] px-4 py-3 text-sm">{formatNullableValue(template.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
