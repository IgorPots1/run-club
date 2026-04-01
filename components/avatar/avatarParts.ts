export type AvatarCategory = 'body' | 'hair' | 'top' | 'bottom' | 'shoes' | 'accessory'

export type AvatarPart = {
  id: string
  category: AvatarCategory
  name: string
  image: string
}

export const avatarCategories: AvatarCategory[] = [
  'body',
  'hair',
  'top',
  'bottom',
  'shoes',
  'accessory',
]

export const avatarCategoryLabels: Record<AvatarCategory, string> = {
  body: 'Body',
  hair: 'Hair',
  top: 'Top',
  bottom: 'Bottom',
  shoes: 'Shoes',
  accessory: 'Accessory',
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
    `<path d="M66 83c0-10 8-18 18-18h32c10 0 18 8 18 18v12l-9 32H75l-9-32V83Z" fill="${fill}" />
     <path d="M75 95 61 108v17h18V98l8-8Zm50 0 14 13v17h-18V98l-8-8Z" fill="${fill}" />
     <path d="M88 65h24l-6 14H94l-6-14Z" fill="${trim}" />
     <path d="M83 92h34M87 103h26" stroke="${trim}" stroke-width="3" stroke-linecap="round" opacity="0.8" />`,
    `<path d="M63 82c0-9 8-17 17-17h40c9 0 17 8 17 17v42H63V82Z" fill="${fill}" />
     <path d="M63 88 48 100v19h18V99l8-10Zm74 0 15 12v19h-18V99l-8-10Z" fill="${fill}" />
     <path d="M94 66h12v58H94V66Z" fill="${trim}" />
     <path d="M83 66h34l-4 12H87l-4-12Z" fill="${trim}" />
     <path d="M78 108h44" stroke="${trim}" stroke-width="3" stroke-linecap="round" opacity="0.55" />`,
    `<path d="M64 83c0-10 8-18 18-18h36c10 0 18 8 18 18v41H64V83Z" fill="${fill}" />
     <path d="M64 88 50 101v18h18V98l7-10Zm72 0 14 13v18h-18V98l-7-10Z" fill="${fill}" />
     <path d="M85 65h30l-4 12H89l-4-12Z" fill="${trim}" />
     <rect x="84" y="91" width="32" height="20" rx="4" fill="${trim}" opacity="0.9" />
     <path d="M88 96h24M93 102h14" stroke="${fill}" stroke-width="2.5" stroke-linecap="round" />`,
    `<path d="M63 82c0-9 7-17 17-17h40c9 0 17 8 17 17v43H63V82Z" fill="${fill}" />
     <path d="M63 88 48 100v19h18V99l8-11Zm74 0 15 12v19h-18V99l-8-11Z" fill="${fill}" />
     <path d="M84 66h32l-5 12H89l-5-12Z" fill="${trim}" />
     <path d="M72 94h56" stroke="${trim}" stroke-width="4" stroke-linecap="round" opacity="0.9" />
     <path d="M81 106h38" stroke="${trim}" stroke-width="3" stroke-linecap="round" opacity="0.65" />`,
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
    `<path d="M73 170h14l10 5h10c6 0 11 4 14 10H73v-15Z" fill="${fill}" />
     <path d="M99 170h14l10 5h10c6 0 11 4 14 10H99v-15Z" fill="${fill}" />
     <path d="M73 182h48m-22 0h48" stroke="${sole}" stroke-width="5" stroke-linecap="round" />
     <path d="M81 174h17m28 0h17" stroke="${sole}" stroke-width="2.5" stroke-linecap="round" opacity="0.85" />`,
    `<path d="M72 169h15l9 6h13c6 0 10 4 14 10H72v-16Z" fill="${fill}" />
     <path d="M99 169h15l9 6h13c6 0 10 4 14 10H99v-16Z" fill="${fill}" />
     <path d="M72 181h51m-24 0h51" stroke="${sole}" stroke-width="4" stroke-linecap="round" />
     <path d="M80 173h19m27 0h19" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.9" />
     <path d="M92 169v6m27-6v6" stroke="${sole}" stroke-width="3" stroke-linecap="round" />`,
    `<path d="M74 171h13l11 4h10c7 0 12 4 15 10H74v-14Z" fill="${fill}" />
     <path d="M100 171h13l11 4h10c7 0 12 4 15 10H100v-14Z" fill="${fill}" />
     <path d="M74 183h49m-23 0h49" stroke="${sole}" stroke-width="4.5" stroke-linecap="round" />
     <path d="M83 175h8l4 3m31-3h8l4 3" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.95" />
     <path d="M77 179h13m26 0h13" stroke="${sole}" stroke-width="2.5" stroke-linecap="round" opacity="0.75" />`,
    `<path d="M72 170h14l10 5h11c6 0 11 4 15 10H72v-15Z" fill="${fill}" />
     <path d="M98 170h14l10 5h11c6 0 11 4 15 10H98v-15Z" fill="${fill}" />
     <path d="M72 183h50m-24 0h50" stroke="${sole}" stroke-width="5" stroke-linecap="round" />
     <path d="M77 176h41m7 0h16" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.85" />
     <path d="M92 171h9m25 0h9" stroke="${sole}" stroke-width="2.5" stroke-linecap="round" opacity="0.8" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

function makeAccessorySvg(fill: string, detail: string, variant: number) {
  const shapes = [
    `<path d="M73 28c5-9 16-14 27-14s22 5 27 14l3 8H70l3-8Z" fill="${fill}" />
     <path d="M74 36h52c0 11-11 18-26 18S74 47 74 36Z" fill="${fill}" />
     <path d="M79 36h42" stroke="${detail}" stroke-width="3" stroke-linecap="round" opacity="0.85" />`,
    `<rect x="41" y="92" width="18" height="8" rx="4" fill="${fill}" />
     <rect x="45" y="89" width="10" height="14" rx="4" fill="${detail}" />
     <rect x="47" y="92" width="6" height="8" rx="2" fill="#dbeafe" />
     <path d="M41 96H34m25 0h7" stroke="${fill}" stroke-width="3" stroke-linecap="round" />`,
    `<path d="M73 30c4-8 15-13 27-13 13 0 24 5 28 13" stroke="${fill}" stroke-width="8" stroke-linecap="round" />
     <path d="M77 33h46c0 9-10 15-23 15S77 42 77 33Z" fill="${fill}" />
     <path d="M85 33h30" stroke="${detail}" stroke-width="3" stroke-linecap="round" opacity="0.9" />`,
    `<rect x="137" y="90" width="12" height="28" rx="5" fill="${fill}" />
     <rect x="139" y="92" width="8" height="24" rx="4" fill="${detail}" opacity="0.85" />
     <path d="M143 90V83" stroke="${fill}" stroke-width="4" stroke-linecap="round" />
     <path d="M143 118v7" stroke="${fill}" stroke-width="4" stroke-linecap="round" />`,
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
  { id: 'top-ocean', category: 'top', name: 'Race Singlet', image: makeTopSvg('#2f80ed', '#dbeafe', 0) },
  { id: 'top-sunrise', category: 'top', name: 'Quarter Zip', image: makeTopSvg('#f97316', '#ffedd5', 1) },
  { id: 'top-forest', category: 'top', name: 'Bib Tank', image: makeTopSvg('#15803d', '#dcfce7', 2) },
  { id: 'top-berry', category: 'top', name: 'Wind Shell', image: makeTopSvg('#a21caf', '#f5d0fe', 3) },
]

export const bottomParts: AvatarPart[] = [
  { id: 'bottom-midnight', category: 'bottom', name: 'Midnight Shorts', image: makeBottomSvg('#1e293b', '#475569', 0) },
  { id: 'bottom-stone', category: 'bottom', name: 'Stone Joggers', image: makeBottomSvg('#6b7280', '#4b5563', 1) },
  { id: 'bottom-olive', category: 'bottom', name: 'Olive Tights', image: makeBottomSvg('#4d7c0f', '#365314', 2) },
  { id: 'bottom-plum', category: 'bottom', name: 'Plum Track Pants', image: makeBottomSvg('#7c3aed', '#c4b5fd', 3) },
]

export const shoesParts: AvatarPart[] = [
  { id: 'shoes-sprint', category: 'shoes', name: 'Carbon Racer', image: makeShoesSvg('#f8fafc', '#94a3b8', 0) },
  { id: 'shoes-volt', category: 'shoes', name: 'Tempo Volt', image: makeShoesSvg('#84cc16', '#0f172a', 1) },
  { id: 'shoes-coral', category: 'shoes', name: 'Flyknit Coral', image: makeShoesSvg('#fb7185', '#475569', 2) },
  { id: 'shoes-ink', category: 'shoes', name: 'Night Trainer', image: makeShoesSvg('#0f172a', '#38bdf8', 3) },
]

export const accessoryParts: AvatarPart[] = [
  { id: 'accessory-cap', category: 'accessory', name: 'Running Cap', image: makeAccessorySvg('#111827', '#93c5fd', 0) },
  { id: 'accessory-watch', category: 'accessory', name: 'GPS Watch', image: makeAccessorySvg('#0f172a', '#22c55e', 1) },
  { id: 'accessory-visor', category: 'accessory', name: 'Race Visor', image: makeAccessorySvg('#ffffff', '#f97316', 2) },
  { id: 'accessory-armband', category: 'accessory', name: 'Phone Armband', image: makeAccessorySvg('#1f2937', '#60a5fa', 3) },
]

export const avatarPartsByCategory: Record<AvatarCategory, AvatarPart[]> = {
  body: bodyParts,
  hair: hairParts,
  top: topParts,
  bottom: bottomParts,
  shoes: shoesParts,
  accessory: accessoryParts,
}
