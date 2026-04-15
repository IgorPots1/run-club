import WorkoutDetailShell from '@/components/WorkoutDetailShell'

export default function UserProfileLoading() {
  return (
    <WorkoutDetailShell title="Профиль участника" enableSourceRestore pinnedHeader>
      <div className="space-y-7">
        <section className="app-card rounded-3xl border px-5 py-6 shadow-sm sm:px-6 sm:py-7" aria-hidden="true">
          <div className="flex flex-col items-center text-center">
            <div className="h-32 w-32 rounded-full skeleton-line sm:h-36 sm:w-36" />
            <div className="mt-4 w-full max-w-xs space-y-3">
              <div className="mx-auto skeleton-line h-7 w-40" />
              <div className="mx-auto skeleton-line h-4 w-32" />
              <div className="mx-auto skeleton-line h-4 w-24" />
              <div className="mx-auto skeleton-line h-9 w-28" />
              <div className="skeleton-line h-2 w-full" />
              <div className="mx-auto skeleton-line h-4 w-36" />
            </div>
          </div>
        </section>

        <section className="space-y-3" aria-hidden="true">
          <div className="app-card rounded-2xl border p-4 shadow-sm">
            <div className="skeleton-line h-5 w-28" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="app-surface-muted rounded-xl p-3">
                <div className="skeleton-line h-3 w-16" />
                <div className="mt-2 skeleton-line h-5 w-20" />
              </div>
              <div className="app-surface-muted rounded-xl p-3">
                <div className="skeleton-line h-3 w-16" />
                <div className="mt-2 skeleton-line h-5 w-12" />
              </div>
            </div>
          </div>
          <div className="app-surface-muted rounded-2xl px-3 py-3 ring-1 ring-black/5 dark:ring-white/10">
            <div className="skeleton-line h-4 w-40" />
            <div className="mt-3 skeleton-line h-40 w-full" />
          </div>
        </section>

        <section className="app-card rounded-3xl border p-4 shadow-sm sm:p-5" aria-hidden="true">
          <div className="skeleton-line h-6 w-28" />
          <div className="mt-4 space-y-3">
            <div className="app-surface-muted rounded-2xl border border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
              <div className="skeleton-line h-4 w-36" />
              <div className="mt-2 skeleton-line h-4 w-28" />
            </div>
            <div className="app-surface-muted rounded-2xl border border-black/[0.06] px-4 py-3 dark:border-white/[0.08]">
              <div className="skeleton-line h-4 w-32" />
              <div className="mt-2 skeleton-line h-4 w-24" />
            </div>
          </div>
        </section>

        <section aria-hidden="true">
          <div className="mb-3 skeleton-line h-6 w-40" />
          <div className="space-y-4">
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
        </section>
      </div>
    </WorkoutDetailShell>
  )
}
