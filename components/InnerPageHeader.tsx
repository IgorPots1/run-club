import MobileBackHeader from '@/components/MobileBackHeader'

type InnerPageHeaderProps = {
  title: string
  fallbackHref?: string
  minimal?: boolean
}

export default function InnerPageHeader({
  title,
  fallbackHref,
  minimal = false,
}: InnerPageHeaderProps) {
  const headerClassName = minimal ? 'mb-0' : 'mb-0 md:mt-4'

  return (
    <MobileBackHeader
      title={title}
      fallbackHref={fallbackHref}
      sticky={false}
      fullBleedOnMobile={false}
      minimal={minimal}
      className={headerClassName}
    />
  )
}
