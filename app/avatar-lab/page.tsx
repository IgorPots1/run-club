import AvatarEditor from '@/components/avatar/AvatarEditor'

export default function AvatarLabPage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6">
        <div className="max-w-2xl space-y-2 text-center">
          <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
            Sandbox
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Avatar Lab
          </h1>
          <p className="text-sm text-slate-600 sm:text-base">
            A local-only layered avatar editor for quick experiments. Swap parts, preview the stack,
            and iterate without touching the backend.
          </p>
        </div>

        <AvatarEditor />
      </div>
    </main>
  )
}
