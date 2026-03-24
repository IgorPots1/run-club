'use client'

type UnreadBadgeProps = {
  count: number
  className?: string
}

function getUnreadBadgeLabel(count: number) {
  if (count <= 0) {
    return ''
  }

  return count > 9 ? '9+' : String(count)
}

export default function UnreadBadge({ count, className = '' }: UnreadBadgeProps) {
  if (count <= 0) {
    return null
  }

  return (
    <span
      className={`inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white ${className}`.trim()}
    >
      {getUnreadBadgeLabel(count)}
    </span>
  )
}
