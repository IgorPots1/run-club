import MobileBackHeader from '@/components/MobileBackHeader'

type InnerPageHeaderProps = {
  title: string
  fallbackHref?: string
}

export default function InnerPageHeader({
  title,
  fallbackHref,
}: InnerPageHeaderProps) {
  return (
    <MobileBackHeader
      title={title}
      fallbackHref={fallbackHref}
      sticky={false}
      fullBleedOnMobile={false}
      className="mb-0 md:mt-4"
    />
  )
}
