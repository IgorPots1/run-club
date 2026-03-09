'use client'

type RunLikeControlProps = {
  likesCount: number
  likedByMe: boolean
  pending: boolean
  onToggle: () => void
}

export default function RunLikeControl({
  likesCount,
  likedByMe,
  pending,
  onToggle,
}: RunLikeControlProps) {
  const likesLabel = likesCount === 1 ? 'лайк' : likesCount >= 2 && likesCount <= 4 ? 'лайка' : 'лайков'

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <p className="app-text-secondary min-w-0 flex items-center gap-1 text-xs">
        <span className="text-[10px]">❤️</span>
        <span className="truncate">{likesCount} {likesLabel}</span>
      </p>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className={`min-h-10 shrink-0 rounded-full border px-3 py-2 text-xs font-medium leading-none transition-colors ${
          likedByMe
            ? 'border-gray-200 bg-gray-100 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-50'
            : 'app-button-secondary'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? '...' : likedByMe ? '♥ Убрать лайк' : '♡ Лайк'}
      </button>
    </div>
  )
}
