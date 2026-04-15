import WorkoutDetailShell from '@/components/WorkoutDetailShell'

export default function RunDetailLoading() {
  return (
    <WorkoutDetailShell title="Тренировка" enableSourceRestore pinnedHeader>
      <div className="min-w-0 overflow-x-hidden space-y-4">
        <section className="app-card rounded-2xl border p-4 shadow-sm" aria-hidden="true">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full skeleton-line" />
              <div className="min-w-0 space-y-2">
                <div className="skeleton-line h-4 w-28" />
                <div className="skeleton-line h-3 w-24" />
              </div>
            </div>
            <div className="h-6 w-16 rounded-full skeleton-line" />
          </div>

          <div className="mt-4 skeleton-line h-7 w-44" />

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="app-surface-muted rounded-xl p-3">
              <div className="skeleton-line h-3 w-16" />
              <div className="mt-2 skeleton-line h-5 w-20" />
            </div>
            <div className="app-surface-muted rounded-xl p-3">
              <div className="skeleton-line h-3 w-24" />
              <div className="mt-2 skeleton-line h-5 w-20" />
            </div>
            <div className="app-surface-muted rounded-xl p-3">
              <div className="skeleton-line h-3 w-20" />
              <div className="mt-2 skeleton-line h-5 w-24" />
            </div>
            <div className="app-surface-muted rounded-xl p-3">
              <div className="skeleton-line h-3 w-20" />
              <div className="mt-2 skeleton-line h-5 w-16" />
            </div>
          </div>
        </section>

        <section className="app-card rounded-2xl border p-4 shadow-sm" aria-hidden="true">
          <div className="skeleton-line h-6 w-28" />
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="app-surface-muted rounded-xl p-3">
              <div className="skeleton-line h-3 w-16" />
              <div className="mt-2 skeleton-line h-5 w-10" />
            </div>
            <div className="app-surface-muted rounded-xl p-3">
              <div className="skeleton-line h-3 w-24" />
              <div className="mt-2 skeleton-line h-5 w-10" />
            </div>
          </div>
        </section>
      </div>
    </WorkoutDetailShell>
  )
}
