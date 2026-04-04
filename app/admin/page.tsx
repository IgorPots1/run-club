import Link from 'next/link'

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="app-text-primary text-2xl font-bold">Админка</h1>
        <p className="app-text-secondary text-sm">
          Быстрый доступ к управлению челленджами, пользователями и журналу действий.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/admin/challenges" className="app-card rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md">
          <p className="app-text-primary text-base font-semibold">Челленджи</p>
          <p className="app-text-secondary mt-1 text-sm">Создание, редактирование и доступ.</p>
        </Link>
        <Link href="/admin/users" className="app-card rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md">
          <p className="app-text-primary text-base font-semibold">Пользователи</p>
          <p className="app-text-secondary mt-1 text-sm">Статус доступа и ручные корректировки XP.</p>
        </Link>
        <Link href="/admin/audit" className="app-card rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md">
          <p className="app-text-primary text-base font-semibold">Журнал действий</p>
          <p className="app-text-secondary mt-1 text-sm">Последние административные изменения.</p>
        </Link>
      </div>
    </div>
  )
}
