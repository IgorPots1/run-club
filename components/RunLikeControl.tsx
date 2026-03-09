'use client'

type RunLikeControlProps = {
  likesCount: number
  likedByMe: boolean
  pending: boolean
  onToggle: () => void
  summaryPrefix?: string
}

export default function RunLikeControl({
  likesCount,
  likedByMe,
  pending,
  onToggle,
  summaryPrefix,
}: RunLikeControlProps) {
  const likesLabel = likesCount === 1 ? 'лайк' : likesCount >= 2 && likesCount <= 4 ? 'лайка' : 'лайков'
  const summaryLabel = summaryPrefix
    ? `${summaryPrefix} • ❤️ ${likesCount}`
    : `❤️ ${likesCount} ${likesLabel}`

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <p className="app-text-secondary min-w-0 flex items-center gap-1 text-xs">
        <span className="truncate">{summaryLabel}</span>
      </p>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className={`min-h-10 shrink-0 rounded-full border px-3 py-2 text-xs font-medium leading-none transition-colors ${
          likedByMe
            ? 'app-like-button-active'
            : 'app-like-button-inactive'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? '...' : likedByMe ? '♥ Убрать лайк' : '♡ Лайк'}
      </button>
    </div>
  )
}
