'use client'

import { Heart, LoaderCircle } from 'lucide-react'

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

  if (variant === 'inline') {
    return (
      <div className="app-inline-like-row text-xs">
        {summaryPrefix ? <p className="app-inline-like-summary truncate">{summaryPrefix}</p> : null}
        {summaryPrefix ? <span className="app-inline-like-separator">•</span> : null}
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          aria-label={likedByMe ? 'Убрать лайк' : 'Поставить лайк'}
          className={`app-inline-like-button ${
            likedByMe ? 'app-inline-like-button-active' : 'app-inline-like-button-inactive'
          }`}
        >
          <span aria-hidden="true" className="app-inline-like-button-icon">
            {pending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.9} />
            ) : (
              <Heart className="h-4 w-4" strokeWidth={1.9} fill={likedByMe ? 'currentColor' : 'none'} />
            )}
          </span>
          <span className="app-inline-like-button-count">{likesCount}</span>
        </button>
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2.5 ${compactOnSmall ? 'compact-run-card-like-row' : ''}`}>
      <p className={`app-text-secondary min-w-0 flex items-center gap-1 text-xs ${compactOnSmall ? 'compact-run-card-like-summary' : ''}`}>
        {summaryPrefix ? <span className="truncate">{summaryPrefix}</span> : null}
        {summaryPrefix ? <span>•</span> : null}
        <Heart className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} fill={likedByMe ? 'currentColor' : 'none'} />
        <span className="truncate">{likesCount} {likesLabel}</span>
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
        <span className="inline-flex items-center gap-1">
          {pending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
          ) : (
            <Heart className="h-3.5 w-3.5" strokeWidth={1.9} fill={likedByMe ? 'currentColor' : 'none'} />
          )}
          <span>{likedByMe ? 'Убрать лайк' : 'Лайк'}</span>
        </span>
      </button>
    </div>
  )
}
