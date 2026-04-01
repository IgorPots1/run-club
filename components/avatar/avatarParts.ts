export type AvatarCategory = 'body' | 'hair' | 'top' | 'bottom' | 'shoes'

export type AvatarPart = {
  id: string
  category: AvatarCategory
  name: string
  image: string
}

export const avatarCategories: AvatarCategory[] = ['body', 'hair', 'top', 'bottom', 'shoes']

export const avatarCategoryLabels: Record<AvatarCategory, string> = {
  body: 'Body',
  hair: 'Hair',
  top: 'Top',
  bottom: 'Bottom',
  shoes: 'Shoes',
}

function toDataUri(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function makeBodySvg(skin: string, accent: string) {
  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      <circle cx="100" cy="42" r="24" fill="${skin}" />
      <rect x="90" y="64" width="20" height="20" rx="10" fill="${skin}" />
      <rect x="72" y="78" width="56" height="64" rx="28" fill="${skin}" />
      <rect x="40" y="86" width="36" height="16" rx="8" fill="${skin}" />
      <rect x="124" y="86" width="36" height="16" rx="8" fill="${skin}" />
      <rect x="78" y="138" width="18" height="42" rx="9" fill="${skin}" />
      <rect x="104" y="138" width="18" height="42" rx="9" fill="${skin}" />
      <circle cx="100" cy="42" r="24" stroke="${accent}" stroke-width="3" opacity="0.18" />
    </svg>
  `)
}

function makeHairSvg(fill: string, variant: number) {
  const shapes = [
    `<path d="M76 42c0-16 11-28 28-28 17 0 30 12 30 28v6H76v-6Z" fill="${fill}" />
     <path d="M80 48c0-11 9-20 20-20h7c11 0 20 9 20 20v14H80V48Z" fill="${fill}" />`,
    `<path d="M74 42c2-17 14-28 30-28 17 0 29 11 31 28v4H74v-4Z" fill="${fill}" />
     <path d="M78 46c0-10 8-18 18-18h12c10 0 18 8 18 18v8c0 11-8 20-18 20H96c-10 0-18-9-18-20v-8Z" fill="${fill}" />`,
    `<path d="M71 42c0-17 12-29 29-29h5c17 0 29 12 29 29v7H71v-7Z" fill="${fill}" />
     <path d="M72 44c4 8 12 12 24 12 15 0 24-5 32-12v18c0 9-8 16-17 16H89c-9 0-17-7-17-16V44Z" fill="${fill}" />`,
    `<path d="M73 40c4-16 16-26 32-26 18 0 30 10 31 29l-16-6-14 6-13-7-20 9v-5Z" fill="${fill}" />
     <path d="M77 44c6 7 14 10 24 10 10 0 18-3 24-10v17c0 10-8 18-18 18H95c-10 0-18-8-18-18V44Z" fill="${fill}" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

function makeTopSvg(fill: string, trim: string, variant: number) {
  const shapes = [
    `<path d="M62 82c0-9 7-16 16-16h44c9 0 16 7 16 16v42H62V82Z" fill="${fill}" />
     <path d="M62 84 49 97v22h20V92l-7-8Zm76 0 13 13v22h-20V92l7-8Z" fill="${fill}" />
     <path d="M87 66h26v13c0 5-4 9-9 9h-8c-5 0-9-4-9-9V66Z" fill="${trim}" />`,
    `<path d="M60 81c0-8 7-15 15-15h50c8 0 15 7 15 15v45H60V81Z" fill="${fill}" />
     <path d="M60 85 44 100v18h20V96l8-11Zm80 0 16 15v18h-20V96l-8-11Z" fill="${trim}" />
     <rect x="90" y="66" width="20" height="12" rx="6" fill="${trim}" />`,
    `<path d="M59 84c0-10 8-18 18-18h46c10 0 18 8 18 18v40H59V84Z" fill="${fill}" />
     <path d="M59 88 47 100v18h18V99l8-11Zm82 0 12 12v18h-18V99l-8-11Z" fill="${fill}" />
     <path d="M82 66h36l-6 14H88l-6-14Z" fill="${trim}" />`,
    `<path d="M61 82c0-9 7-16 16-16h46c9 0 16 7 16 16v46H61V82Z" fill="${fill}" />
     <path d="M61 84 46 97v20h19V96l8-12Zm78 0 15 13v20h-19V96l-8-12Z" fill="${fill}" />
     <path d="M80 67h40l-10 12H90L80 67Z" fill="${trim}" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

function makeBottomSvg(fill: string, accent: string, variant: number) {
  const shapes = [
    `<path d="M68 122h64v16c0 8-6 14-14 14H82c-8 0-14-6-14-14v-16Z" fill="${fill}" />
     <path d="M80 138h16v38H82c-5 0-8-4-8-8v-16c0-8 3-11 6-14Zm24 0h16c3 3 6 6 6 14v16c0 4-3 8-8 8h-14v-38Z" fill="${accent}" />`,
    `<path d="M70 120h60v18H70v-18Z" fill="${fill}" />
     <path d="M78 138h18v40H82c-6 0-10-4-10-10v-10c0-11 2-16 6-20Zm26 0h18c4 4 6 9 6 20v10c0 6-4 10-10 10h-14v-40Z" fill="${fill}" />`,
    `<path d="M69 120h62v16c0 6-5 11-11 11H80c-6 0-11-5-11-11v-16Z" fill="${fill}" />
     <path d="M80 137h16v40H84c-6 0-10-4-10-10v-14c0-7 2-12 6-16Zm24 0h16c4 4 6 9 6 16v14c0 6-4 10-10 10h-12v-40Z" fill="${accent}" />`,
    `<path d="M68 120h64v20c0 7-6 12-12 12H80c-6 0-12-5-12-12v-20Z" fill="${fill}" />
     <path d="M74 124h52" stroke="${accent}" stroke-width="4" stroke-linecap="round" />
     <path d="M80 140h16v38H84c-6 0-10-4-10-10v-10c0-9 2-14 6-18Zm24 0h16c4 4 6 9 6 18v10c0 6-4 10-10 10h-12v-38Z" fill="${fill}" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

function makeShoesSvg(fill: string, sole: string, variant: number) {
  const shapes = [
    `<path d="M71 174h31c5 0 9 4 9 9v3H71v-12Z" fill="${fill}" />
     <path d="M98 174h31c5 0 9 4 9 9v3H98v-12Z" fill="${fill}" />
     <path d="M71 184h40m-13 0h40" stroke="${sole}" stroke-width="4" stroke-linecap="round" />`,
    `<path d="M69 173h30c8 0 14 6 14 13H69v-13Z" fill="${fill}" />
     <path d="M101 173h30c8 0 14 6 14 13h-44v-13Z" fill="${fill}" />
     <path d="M69 182h44m-12 0h44" stroke="${sole}" stroke-width="3" stroke-linecap="round" />`,
    `<path d="M72 175h28c6 0 11 4 13 10H72v-10Z" fill="${fill}" />
     <path d="M100 175h28c6 0 11 4 13 10h-41v-10Z" fill="${fill}" />
     <circle cx="84" cy="180" r="2" fill="${sole}" />
     <circle cx="112" cy="180" r="2" fill="${sole}" />`,
    `<path d="M70 172h32c7 0 12 6 12 14H70v-14Z" fill="${fill}" />
     <path d="M98 172h32c7 0 12 6 12 14H98v-14Z" fill="${fill}" />
     <path d="M70 185h44m-14 0h44" stroke="${sole}" stroke-width="4" stroke-linecap="round" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

export const bodyParts: AvatarPart[] = [
  { id: 'body-light', category: 'body', name: 'Light', image: makeBodySvg('#f6d2bf', '#b27155') },
  { id: 'body-medium', category: 'body', name: 'Warm', image: makeBodySvg('#d6a283', '#8b5a3d') },
  { id: 'body-deep', category: 'body', name: 'Deep', image: makeBodySvg('#8c5b46', '#58372c') },
  { id: 'body-cool', category: 'body', name: 'Cool', image: makeBodySvg('#c89279', '#7f5646') },
]

export const hairParts: AvatarPart[] = [
  { id: 'hair-espresso', category: 'hair', name: 'Espresso', image: makeHairSvg('#39261b', 0) },
  { id: 'hair-auburn', category: 'hair', name: 'Auburn', image: makeHairSvg('#7d3f2b', 1) },
  { id: 'hair-blonde', category: 'hair', name: 'Blonde', image: makeHairSvg('#c89f4d', 2) },
  { id: 'hair-blue', category: 'hair', name: 'Blue Pop', image: makeHairSvg('#334ec7', 3) },
]

export const topParts: AvatarPart[] = [
  { id: 'top-ocean', category: 'top', name: 'Ocean Tee', image: makeTopSvg('#2f80ed', '#dbeafe', 0) },
  { id: 'top-sunrise', category: 'top', name: 'Sunrise Crew', image: makeTopSvg('#f97316', '#fed7aa', 1) },
  { id: 'top-forest', category: 'top', name: 'Forest Zip', image: makeTopSvg('#15803d', '#bbf7d0', 2) },
  { id: 'top-berry', category: 'top', name: 'Berry Hoodie', image: makeTopSvg('#a21caf', '#f5d0fe', 3) },
]

export const bottomParts: AvatarPart[] = [
  { id: 'bottom-midnight', category: 'bottom', name: 'Midnight Shorts', image: makeBottomSvg('#1e293b', '#475569', 0) },
  { id: 'bottom-stone', category: 'bottom', name: 'Stone Joggers', image: makeBottomSvg('#6b7280', '#4b5563', 1) },
  { id: 'bottom-olive', category: 'bottom', name: 'Olive Tights', image: makeBottomSvg('#4d7c0f', '#365314', 2) },
  { id: 'bottom-plum', category: 'bottom', name: 'Plum Track Pants', image: makeBottomSvg('#7c3aed', '#c4b5fd', 3) },
]

export const shoesParts: AvatarPart[] = [
  { id: 'shoes-sprint', category: 'shoes', name: 'Sprint White', image: makeShoesSvg('#f8fafc', '#94a3b8', 0) },
  { id: 'shoes-volt', category: 'shoes', name: 'Volt', image: makeShoesSvg('#84cc16', '#1f2937', 1) },
  { id: 'shoes-coral', category: 'shoes', name: 'Coral', image: makeShoesSvg('#fb7185', '#475569', 2) },
  { id: 'shoes-ink', category: 'shoes', name: 'Ink', image: makeShoesSvg('#0f172a', '#38bdf8', 3) },
]

export const avatarPartsByCategory: Record<AvatarCategory, AvatarPart[]> = {
  body: bodyParts,
  hair: hairParts,
  top: topParts,
  bottom: bottomParts,
  shoes: shoesParts,
}
