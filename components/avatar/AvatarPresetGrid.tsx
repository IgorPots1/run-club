'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { avatarPresets, type AvatarPreset, type AvatarRarity } from './avatarPresets'

const rarityClasses: Record<AvatarRarity, string> = {
  common: 'border-slate-200 bg-slate-100 text-slate-700',
  rare: 'border-sky-200 bg-sky-50 text-sky-700',
  epic: 'border-violet-200 bg-violet-50 text-violet-700',
}

export default function AvatarPresetGrid() {
  const [selectedAvatarId, setSelectedAvatarId] = useState(avatarPresets[0]?.id ?? '')

  const selectedAvatar = useMemo<AvatarPreset | undefined>(
    () => avatarPresets.find((avatar) => avatar.id === selectedAvatarId) ?? avatarPresets[0],
    [selectedAvatarId]
  )

  return (
    <section className="w-full max-w-5xl rounded-[32px] border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur sm:p-8">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative h-[260px] w-[260px] overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-b from-slate-50 to-white shadow-inner">
            <div className="absolute inset-5 rounded-[26px] bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_52%)]" />
            {selectedAvatar ? (
              <Image
                src={selectedAvatar.image}
                alt={selectedAvatar.name}
                fill
                unoptimized
                sizes="260px"
                className="absolute inset-0 h-full w-full object-contain p-4"
              />
            ) : null}
          </div>

          {selectedAvatar ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-2xl font-semibold text-slate-950">{selectedAvatar.name}</h2>
                <span
                  className={[
                    'rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em]',
                    rarityClasses[selectedAvatar.rarity],
                  ].join(' ')}
                >
                  {selectedAvatar.rarity}
                </span>
              </div>
              <p className="text-sm text-slate-600">
                Pick a ready-made runner preset and preview it instantly.
              </p>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {avatarPresets.map((avatar) => {
            const isSelected = avatar.id === selectedAvatar?.id

            return (
              <button
                key={avatar.id}
                type="button"
                onClick={() => setSelectedAvatarId(avatar.id)}
                className={[
                  'rounded-2xl border p-3 text-left transition',
                  'focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2',
                  isSelected
                    ? 'border-sky-400 bg-sky-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                ].join(' ')}
              >
                <div className="relative mb-3 h-28 overflow-hidden rounded-xl bg-slate-100">
                  <Image
                    src={avatar.image}
                    alt={avatar.name}
                    fill
                    unoptimized
                    sizes="112px"
                    className="absolute inset-0 h-full w-full object-contain p-2"
                  />
                </div>

                <div className="mb-2 text-sm font-medium text-slate-900">{avatar.name}</div>
                <span
                  className={[
                    'inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
                    rarityClasses[avatar.rarity],
                  ].join(' ')}
                >
                  {avatar.rarity}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
