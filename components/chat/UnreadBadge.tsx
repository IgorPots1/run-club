'use client'

type UnreadBadgeProps = {
  count: number
  className?: string
  maxDisplayCount?: number
}

function getUnreadBadgeLabel(count: number, maxDisplayCount: number) {
  if (count <= 0) {
    return ''
  }

  return count > maxDisplayCount ? `${maxDisplayCount}+` : String(count)
}

export default function UnreadBadge({
  count,
  className = '',
  maxDisplayCount = 9,
}: UnreadBadgeProps) {
  if (count <= 0) {
    return null
  }

  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-white ${className}`.trim()}
    >
      {getUnreadBadgeLabel(count, maxDisplayCount)}
    </span>
  )
}
