export default function DashboardLoading() {
  return (
    <main className="min-h-screen pt-[env(safe-area-inset-top)] md:pt-0">
      <div className="mx-auto max-w-xl px-4 pb-4 pt-4 md:p-4">
        <div className="mb-6 flex items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="app-text-primary text-lg font-semibold">Привет</p>
            <div className="mt-1 skeleton-line h-4 w-20" />
          </div>
          <div className="flex items-center gap-1.5 self-start sm:gap-2">
            <div className="skeleton-line h-11 w-11 rounded-full" />
            <div className="skeleton-line h-11 w-11 rounded-full" />
            <div className="skeleton-line h-11 w-11 rounded-full" />
          </div>
        </div>

        <div className="mb-4">
          <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
            <p className="app-text-secondary text-sm font-medium">Мой прогресс</p>
            <div className="mt-3 space-y-2">
              <div className="skeleton-line h-10 w-40" />
              <div className="skeleton-line h-4 w-28" />
              <div className="skeleton-line h-4 w-36" />
            </div>
          </div>

          <section className="mb-4">
            <div className="mb-3 flex items-center gap-2">
              <p className="app-text-secondary text-sm font-medium">Челленджи</p>
            </div>
            <div className="app-card rounded-xl border p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="skeleton-line h-14 w-14 rounded-2xl" />
                <div className="min-w-0 flex-1">
                  <div className="skeleton-line h-5 w-36" />
                  <div className="mt-2 flex items-center gap-2">
                    <div className="skeleton-line h-6 w-24 rounded-full" />
                    <div className="skeleton-line h-4 w-20" />
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <div className="skeleton-line h-2 w-full" />
                <div className="mt-2 space-y-2">
                  <div className="skeleton-line h-4 w-40" />
                  <div className="skeleton-line h-4 w-36" />
                  <div className="skeleton-line h-4 w-28" />
                </div>
              </div>
            </div>
          </section>

          <div className="app-card mb-4 rounded-xl border p-4 shadow-sm">
            <p className="app-text-secondary text-sm font-medium">Уровень</p>
            <div className="flex items-start justify-between gap-3">
              <div className="mt-3 min-w-0 flex-1 space-y-2">
                <div className="skeleton-line h-4 w-24" />
                <div className="skeleton-line h-4 w-28" />
              </div>
              <div className="mt-3 skeleton-line h-4 w-14" />
            </div>
            <div className="mt-3 skeleton-line h-2 w-full" />
            <div className="mt-3 space-y-2">
              <div className="skeleton-line h-6 w-36" />
              <div className="skeleton-line h-4 w-44" />
            </div>
          </div>

          <div className="app-card mb-4 min-h-[188px] rounded-xl border p-4 shadow-sm">
            <p className="app-text-secondary text-sm font-medium">Гонка недели</p>
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
