export type AvatarRarity = 'common' | 'rare' | 'epic'

export type AvatarPreset = {
  id: string
  name: string
  image: string
  rarity: AvatarRarity
}

function toDataUri(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function makePresetSvg({
  skin,
  hair,
  top,
  bottom,
  shoes,
  accent,
  accessory = 'none',
}: {
  skin: string
  hair: string
  top: string
  bottom: string
  shoes: string
  accent: string
  accessory?: 'none' | 'cap' | 'visor'
}) {
  const accessoryMarkup =
    accessory === 'cap'
      ? `<path d="M74 31c4-7 14-11 26-11s22 4 26 11l3 7H71l3-7Z" fill="${accent}" />
         <path d="M75 38h50c0 8-10 14-25 14s-25-6-25-14Z" fill="${accent}" />`
      : accessory === 'visor'
        ? `<path d="M77 34c3-7 13-11 23-11 11 0 20 4 24 11" stroke="${accent}" stroke-width="8" stroke-linecap="round" />
           <path d="M79 37h42c0 7-9 12-21 12s-21-5-21-12Z" fill="${accent}" />`
        : ''

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      <circle cx="100" cy="100" r="96" fill="#f8fafc" />
      <circle cx="100" cy="100" r="92" fill="white" stroke="#e2e8f0" stroke-width="2" />
      <ellipse cx="100" cy="184" rx="42" ry="8" fill="#cbd5e1" opacity="0.45" />
      <circle cx="100" cy="37" r="18" fill="${skin}" />
      ${accessoryMarkup}
      <path d="M78 39c0-12 10-22 22-22 13 0 24 10 24 22v7H78v-7Z" fill="${hair}" />
      <path d="M82 45c4 5 11 8 18 8 9 0 16-3 22-8v9c0 7-6 13-13 13H91c-7 0-13-6-13-13v-9Z" fill="${hair}" />
      <path d="M93 53h14v15c0 4-3 7-7 7s-7-3-7-7V53Z" fill="${skin}" />
      <path d="M76 71 61 93v9h12l12-14-9-17Zm48 0 15 22v9h-12l-12-14 9-17Z" fill="${skin}" />
      <path d="M84 66c4-3 9-5 16-5s12 2 16 5l8 44H76l8-44Z" fill="${top}" />
      <path d="M90 61h20l-4 9H94l-4-9Z" fill="${accent}" />
      <path d="M86 78 81 110m38-32 5 32" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" opacity="0.65" />
      <path d="M92 80h16" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" opacity="0.8" />
      <path d="M79 103h42v12c0 8-6 13-13 13H92c-7 0-13-5-13-13v-12Z" fill="${bottom}" />
      <path d="M87 116h11v56h-7c-8 0-12-4-12-11v-19c0-10 3-18 8-26Zm15 0h11c5 8 8 16 8 26v19c0 7-4 11-12 11h-7v-56Z" fill="${bottom}" opacity="0.96" />
      <path d="M82 172h9l11 5h10c8 0 14 3 18 9H74c2-7 4-11 8-14Z" fill="${shoes}" />
      <path d="M108 172h9l11 5h10c8 0 14 3 18 9H100c2-7 4-11 8-14Z" fill="${shoes}" />
      <path d="M74 185h56c-3 3-14 5-28 5s-25-2-28-5Zm26 0h56c-3 3-14 5-28 5s-25-2-28-5Z" fill="#475569" />
      <path d="M84 178h14l6-2m29 2h14l6-2" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
    </svg>
  `)
}

export const avatarPresets: AvatarPreset[] = [
  {
    id: 'city-strider',
    name: 'City Strider',
    rarity: 'common',
    image: makePresetSvg({
      skin: '#f3cdb5',
      hair: '#352417',
      top: '#2563eb',
      bottom: '#0f172a',
      shoes: '#f8fafc',
      accent: '#dbeafe',
    }),
  },
  {
    id: 'sunrise-pace',
    name: 'Sunrise Pace',
    rarity: 'common',
    image: makePresetSvg({
      skin: '#d5a184',
      hair: '#7c3f2b',
      top: '#f97316',
      bottom: '#475569',
      shoes: '#84cc16',
      accent: '#ffedd5',
    }),
  },
  {
    id: 'night-mile',
    name: 'Night Mile',
    rarity: 'common',
    image: makePresetSvg({
      skin: '#8d5e49',
      hair: '#0f172a',
      top: '#111827',
      bottom: '#1f2937',
      shoes: '#38bdf8',
      accent: '#94a3b8',
    }),
  },
  {
    id: 'club-lane',
    name: 'Club Lane',
    rarity: 'common',
    image: makePresetSvg({
      skin: '#c28f77',
      hair: '#c89f4d',
      top: '#16a34a',
      bottom: '#334155',
      shoes: '#fb7185',
      accent: '#dcfce7',
    }),
  },
  {
    id: 'tempo-wave',
    name: 'Tempo Wave',
    rarity: 'rare',
    image: makePresetSvg({
      skin: '#f2c6af',
      hair: '#1e293b',
      top: '#0ea5e9',
      bottom: '#0f172a',
      shoes: '#f97316',
      accent: '#bae6fd',
      accessory: 'visor',
    }),
  },
  {
    id: 'trail-spark',
    name: 'Trail Spark',
    rarity: 'rare',
    image: makePresetSvg({
      skin: '#976550',
      hair: '#40261d',
      top: '#65a30d',
      bottom: '#3f6212',
      shoes: '#facc15',
      accent: '#ecfccb',
    }),
  },
  {
    id: 'track-flare',
    name: 'Track Flare',
    rarity: 'rare',
    image: makePresetSvg({
      skin: '#dab099',
      hair: '#5b2d1f',
      top: '#db2777',
      bottom: '#6d28d9',
      shoes: '#f8fafc',
      accent: '#fbcfe8',
    }),
  },
  {
    id: 'harbor-dash',
    name: 'Harbor Dash',
    rarity: 'rare',
    image: makePresetSvg({
      skin: '#b67e63',
      hair: '#1f2937',
      top: '#0891b2',
      bottom: '#1e3a8a',
      shoes: '#22c55e',
      accent: '#cffafe',
      accessory: 'cap',
    }),
  },
  {
    id: 'voltage-elite',
    name: 'Voltage Elite',
    rarity: 'epic',
    image: makePresetSvg({
      skin: '#f0c7b0',
      hair: '#1e1b4b',
      top: '#7c3aed',
      bottom: '#312e81',
      shoes: '#a3e635',
      accent: '#ddd6fe',
      accessory: 'visor',
    }),
  },
  {
    id: 'marathon-luxe',
    name: 'Marathon Luxe',
    rarity: 'epic',
    image: makePresetSvg({
      skin: '#865946',
      hair: '#111827',
      top: '#be123c',
      bottom: '#7f1d1d',
      shoes: '#f8fafc',
      accent: '#fecdd3',
      accessory: 'cap',
    }),
  },
]
