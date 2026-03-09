'use client'

type RunLikeControlProps = {
  likesCount: number
  likedByMe: boolean
  pending: boolean
  onToggle: () => void
  summaryPrefix?: string
  compactOnSmall?: boolean
  variant?: 'default' | 'inline'
}

export default function RunLikeControl({
  likesCount,
  likedByMe,
  pending,
  onToggle,
  summaryPrefix,
  compactOnSmall = false,
  variant = 'default',
}: RunLikeControlProps) {
  const likesLabel = likesCount === 1 ? 'лайк' : likesCount >= 2 && likesCount <= 4 ? 'лайка' : 'лайков'
  const summaryLabel = summaryPrefix
    ? `${summaryPrefix} • ❤️ ${likesCount}`
    : `❤️ ${likesCount} ${likesLabel}`
  const likeIcon = likedByMe ? '❤️' : '♡'

  if (variant === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {summaryPrefix ? <p className="app-text-secondary min-w-0 truncate">{summaryPrefix}</p> : null}
        {summaryPrefix ? <span className="app-text-secondary">•</span> : null}
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          aria-label={likedByMe ? 'Убрать лайк' : 'Поставить лайк'}
          className={`inline-flex min-h-8 items-center gap-1 rounded-md px-0.5 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            likedByMe ? 'text-rose-500' : 'app-text-secondary'
          }`}
        >
          <span aria-hidden="true">{pending ? '…' : likeIcon}</span>
          <span>{likesCount}</span>
        </button>
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2.5 ${compactOnSmall ? 'compact-run-card-like-row' : ''}`}>
      <p className={`app-text-secondary min-w-0 flex items-center gap-1 text-xs ${compactOnSmall ? 'compact-run-card-like-summary' : ''}`}>
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
        } ${compactOnSmall ? 'compact-run-card-like-button' : ''} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {pending ? '...' : likedByMe ? '♥ Убрать лайк' : '♡ Лайк'}
      </button>
    </div>
  )
}
