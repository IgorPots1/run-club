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
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-gray-500">
        ❤️ {likesCount} {likesLabel}
      </p>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className={`shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
          likedByMe ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-gray-200 bg-white text-gray-700'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? '...' : likedByMe ? 'Убрать лайк' : '♡ Лайк'}
      </button>
    </div>
  )
}
