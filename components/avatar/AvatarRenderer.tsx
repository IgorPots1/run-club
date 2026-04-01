import Image from 'next/image'
import { type AvatarCategory, type AvatarPart } from './avatarParts'

type AvatarRendererProps = {
  selectedItems: Partial<Record<AvatarCategory, AvatarPart | null>>
}

const renderOrder: AvatarCategory[] = ['body', 'bottom', 'top', 'shoes', 'hair', 'accessory']

export default function AvatarRenderer({ selectedItems }: AvatarRendererProps) {
  return (
    <div className="relative h-[200px] w-[200px] overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-b from-slate-50 to-white shadow-inner">
      <div className="absolute inset-4 rounded-[22px] bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_52%)]" />
      <div className="absolute inset-x-4 bottom-2 top-3">
        {renderOrder.map((category) => {
          const part = selectedItems[category]

          if (!part) {
            return null
          }

          return (
            <Image
              key={part.id}
              src={part.image}
              alt={part.name}
              fill
              unoptimized
              sizes="184px"
              className="absolute inset-0 h-full w-full object-contain"
            />
          )
        })}
      </div>
    </div>
  )
}
