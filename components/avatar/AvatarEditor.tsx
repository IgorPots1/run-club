'use client'

import { useState } from 'react'
import Image from 'next/image'
import AvatarRenderer from './AvatarRenderer'
import {
  avatarCategories,
  avatarCategoryLabels,
  avatarPartsByCategory,
  type AvatarCategory,
  type AvatarPart,
} from './avatarParts'

type AvatarSelection = Record<AvatarCategory, AvatarPart>

function createInitialSelection(): AvatarSelection {
  return avatarCategories.reduce((selection, category) => {
    selection[category] = avatarPartsByCategory[category][0]
    return selection
  }, {} as AvatarSelection)
}

export default function AvatarEditor() {
  const [selectedItems, setSelectedItems] = useState<AvatarSelection>(() => createInitialSelection())

  function handleSelect(category: AvatarCategory, part: AvatarPart) {
    setSelectedItems((current) => ({
      ...current,
      [category]: part,
    }))
  }

  return (
    <section className="w-full max-w-5xl rounded-[32px] border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col items-center gap-4">
          <AvatarRenderer selectedItems={selectedItems} />

          <div className="space-y-1 text-center">
            <h2 className="text-xl font-semibold text-slate-900">Live Preview</h2>
            <p className="text-sm text-slate-600">Pick different parts below to remix the avatar instantly.</p>
          </div>
        </div>

        <div className="space-y-4">
          {avatarCategories.map((category) => (
            <section
              key={category}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {avatarCategoryLabels[category]}
                </h3>
                <span className="text-sm text-slate-600">{selectedItems[category].name}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {avatarPartsByCategory[category].map((part) => {
                  const isSelected = selectedItems[category].id === part.id

                  return (
                    <button
                      key={part.id}
                      type="button"
                      onClick={() => handleSelect(category, part)}
                      className={[
                        'rounded-2xl border p-3 text-left transition',
                        'focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2',
                        isSelected
                          ? 'border-sky-400 bg-sky-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      ].join(' ')}
                    >
                      <div className="relative mb-3 h-20 overflow-hidden rounded-xl bg-slate-100">
                        <Image
                          src={part.image}
                          alt={part.name}
                          fill
                          unoptimized
                          sizes="80px"
                          className="absolute inset-0 h-full w-full object-contain"
                        />
                      </div>

                      <div className="text-sm font-medium text-slate-900">{part.name}</div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </section>
  )
}
