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
  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <p className="text-sm text-gray-500">Лайки: {likesCount}</p>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm ${
          likedByMe ? 'border-black bg-black text-white' : 'border-gray-300'
        } disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? '...' : likedByMe ? 'Убрать лайк' : 'Лайк'}
      </button>
    </div>
  )
}
