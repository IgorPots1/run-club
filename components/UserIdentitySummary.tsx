'use client'

type UserIdentitySummaryProps = {
  loadingIdentity?: boolean
  loadingLevel?: boolean
  displayName: string
  levelLabel?: string | null
  email?: string | null
  className?: string
}

export default function UserIdentitySummary({
  loadingIdentity = false,
  loadingLevel = false,
  displayName,
  levelLabel = null,
  email = null,
  className = '',
}: UserIdentitySummaryProps) {
  return (
    <div className={`min-w-0 space-y-1 ${className}`.trim()}>
      {loadingIdentity ? (
        <div className="space-y-2">
          <div className="skeleton-line h-6 w-40" />
          <div className="skeleton-line h-4 w-20" />
          {email ? <div className="skeleton-line h-4 w-32" /> : null}
        </div>
      ) : (
        <>
          <p className="app-text-primary truncate text-lg font-semibold">{displayName}</p>
          {loadingLevel ? (
            <div className="skeleton-line h-4 w-20" />
          ) : levelLabel ? (
            <p className="app-text-secondary text-sm">{levelLabel}</p>
          ) : null}
          {email ? <p className="app-text-muted truncate text-sm">{email}</p> : null}
        </>
      )}
    </div>
  )
}
