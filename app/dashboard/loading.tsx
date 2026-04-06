import Link from 'next/link'

export default function DashboardLoading() {
  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] pb-[calc(96px+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton-line h-6 w-40" />
            <div className="skeleton-line h-4 w-20" />
          </div>
          <div className="skeleton-line h-11 w-11 rounded-full" />
        </div>

        <div className="mb-4">
          <Link
            href="/runs"
            className="app-button-primary mb-4 mt-4 block min-h-13 w-full rounded-xl px-4 py-3.5 text-center text-base font-semibold shadow-sm shadow-black/15 ring-1 ring-black/5 sm:text-lg dark:ring-white/10"
          >
            + Добавить тренировку
          </Link>

          <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
            <div className="skeleton-line h-4 w-28" />
            <div className="mt-3 space-y-2">
              <div className="skeleton-line h-10 w-44" />
              <div className="skeleton-line h-4 w-24" />
              <div className="skeleton-line h-4 w-32" />
            </div>
          </div>

          <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
            <div className="skeleton-line h-4 w-32" />
            <div className="mt-3 space-y-3">
              <div className="skeleton-line h-6 w-44" />
              <div className="skeleton-line h-2 w-full" />
              <div className="skeleton-line h-4 w-36" />
            </div>
          </div>

          <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="skeleton-line h-4 w-24" />
              <div className="skeleton-line h-8 w-28" />
            </div>
            <div className="mt-3 skeleton-line h-2 w-full" />
            <div className="mt-3 space-y-2">
              <div className="skeleton-line h-6 w-36" />
              <div className="skeleton-line h-4 w-48" />
            </div>
          </div>

          <div className="app-card mb-4 min-h-[188px] rounded-xl border p-4 shadow-sm">
            <div className="skeleton-line h-4 w-28" />
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="skeleton-line h-4 w-32" />
                <div className="skeleton-line h-4 w-14" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="skeleton-line h-4 w-28" />
                <div className="skeleton-line h-4 w-14" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="skeleton-line h-4 w-24" />
                <div className="skeleton-line h-4 w-14" />
              </div>
            </div>
            <div className="mt-4 border-t pt-3">
              <div className="skeleton-line h-4 w-40" />
              <div className="mt-2 skeleton-line h-4 w-32" />
            </div>
          </div>

          <h2 className="app-text-primary mb-3 text-lg font-semibold">Лента</h2>
          <div className="min-h-[236px] space-y-4 pb-2">
            <div className="app-card rounded-xl border p-4 shadow-sm">
              <div className="skeleton-line h-5 w-32" />
              <div className="mt-2 skeleton-line h-4 w-36" />
              <div className="mt-3 space-y-2">
                <div className="skeleton-line h-4 w-20" />
                <div className="skeleton-line h-4 w-16" />
                <div className="skeleton-line h-4 w-24" />
              </div>
            </div>
            <div className="app-card rounded-xl border p-4 shadow-sm">
              <div className="skeleton-line h-5 w-28" />
              <div className="mt-2 skeleton-line h-4 w-40" />
              <div className="mt-3 space-y-2">
                <div className="skeleton-line h-4 w-24" />
                <div className="skeleton-line h-4 w-16" />
                <div className="skeleton-line h-4 w-20" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
