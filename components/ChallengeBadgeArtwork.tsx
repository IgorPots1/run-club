type ChallengeBadgeArtworkProps = {
  badgeUrl?: string | null
  title?: string | null
  className?: string
  imageClassName?: string
  placeholderLabel?: string
}

export default function ChallengeBadgeArtwork({
  badgeUrl,
  title,
  className = 'h-14 w-14 rounded-2xl',
  imageClassName = 'object-cover',
  placeholderLabel = 'Бейдж',
}: ChallengeBadgeArtworkProps) {
  const normalizedBadgeUrl = typeof badgeUrl === 'string' ? badgeUrl.trim() : ''
  const normalizedTitle = typeof title === 'string' && title.trim() ? title.trim() : 'Челлендж'

  if (normalizedBadgeUrl) {
    return (
      <img
        src={normalizedBadgeUrl}
        alt={`Бейдж ${normalizedTitle}`}
        className={`${className} border border-black/[0.06] ${imageClassName} dark:border-white/[0.08]`}
      />
    )
  }

  return (
    <div
      aria-label={`Бейдж по умолчанию для ${normalizedTitle}`}
      className={`${className} app-text-secondary flex items-center justify-center border border-dashed border-black/[0.08] bg-black/[0.02] text-center text-xs font-medium dark:border-white/[0.12] dark:bg-white/[0.04]`}
    >
      <span className="px-2">{placeholderLabel}</span>
    </div>
  )
}
