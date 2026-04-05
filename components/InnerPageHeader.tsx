import MobileBackHeader from '@/components/MobileBackHeader'
import type { ReactNode } from 'react'

type InnerPageHeaderProps = {
  title: string
  fallbackHref?: string
  minimal?: boolean
  rightSlot?: ReactNode
}

export default function InnerPageHeader({
  title,
  fallbackHref,
  minimal = false,
  rightSlot,
}: InnerPageHeaderProps) {
  const headerClassName = minimal ? 'mb-0' : 'mb-0 md:mt-4'

  return (
    <MobileBackHeader
      title={title}
      fallbackHref={fallbackHref}
      sticky={false}
      fullBleedOnMobile={false}
      minimal={minimal}
      rightSlot={rightSlot}
      className={headerClassName}
    />
  )
}
