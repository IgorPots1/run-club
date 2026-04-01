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
      <circle cx="100" cy="38" r="21" fill="${skin}" />
      <path d="M92 57h16v15c0 4-4 8-8 8s-8-4-8-8V57Z" fill="${skin}" />
      <path d="M82 73c4-5 11-8 18-8s14 3 18 8l7 39H75l7-39Z" fill="${skin}" />
      <path d="M75 82 57 100v10h15l11-13-8-15Zm50 0 18 18v10h-15l-11-13 8-15Z" fill="${skin}" />
      <path d="M86 112h12v54c0 9-7 16-16 16h-2v-13c0-5 2-10 5-14l1-43Zm16 0h12l1 43c3 4 5 9 5 14v13h-2c-9 0-16-7-16-16v-54Z" fill="${skin}" />
      <path d="M86 114h28" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity="0.18" />
      <circle cx="100" cy="38" r="21" stroke="${accent}" stroke-width="2.5" opacity="0.18" />
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
    `<path d="M80 72c4-4 10-7 20-7s16 3 20 7l5 37H75l5-37Z" fill="${fill}" />
     <path d="M75 81 62 98v13h14l8-14-9-16Zm50 0 13 17v13h-14l-8-14 9-16Z" fill="${fill}" />
     <path d="M89 66h22l-6 11H95l-6-11Z" fill="${trim}" />
     <path d="M84 80 79 109m37-29 5 29" stroke="${trim}" stroke-width="3" stroke-linecap="round" opacity="0.65" />
     <path d="M92 86h16" stroke="${trim}" stroke-width="2.5" stroke-linecap="round" opacity="0.8" />`,
    `<path d="M79 72c4-4 11-7 21-7s17 3 21 7l4 40H75l4-40Z" fill="${fill}" />
     <path d="M75 81 61 98v13h14l8-14-8-16Zm50 0 14 17v13h-14l-8-14 8-16Z" fill="${fill}" />
     <path d="M94 66h12v46H94V66Z" fill="${trim}" opacity="0.95" />
     <path d="M88 66h24l-5 10H93l-5-10Z" fill="${trim}" />
     <path d="M82 82 78 112m40-30 4 30" stroke="${trim}" stroke-width="3" stroke-linecap="round" opacity="0.5" />`,
    `<path d="M80 72c4-4 10-7 20-7s16 3 20 7l5 38H75l5-38Z" fill="${fill}" />
     <path d="M75 81 62 97v13h14l8-13-9-16Zm50 0 13 16v13h-14l-8-13 9-16Z" fill="${fill}" />
     <path d="M89 66h22l-6 11H95l-6-11Z" fill="${trim}" />
     <rect x="86" y="84" width="28" height="18" rx="4" fill="${trim}" opacity="0.9" />
     <path d="M91 89h18M95 95h10" stroke="${fill}" stroke-width="2.5" stroke-linecap="round" />`,
    `<path d="M79 72c4-4 11-7 21-7s17 3 21 7l4 41H75l4-41Z" fill="${fill}" />
     <path d="M75 81 61 98v13h14l8-14-8-16Zm50 0 14 17v13h-14l-8-14 8-16Z" fill="${fill}" />
     <path d="M88 66h24l-5 11H93l-5-11Z" fill="${trim}" />
     <path d="M85 82 80 113m35-31 5 31" stroke="${trim}" stroke-width="3" stroke-linecap="round" opacity="0.7" />
     <path d="M89 92h22" stroke="${trim}" stroke-width="3" stroke-linecap="round" opacity="0.65" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

function makeBottomSvg(fill: string, accent: string, variant: number) {
  const shapes = [
    `<path d="M74 108h52v13c0 9-7 16-16 16H90c-9 0-16-7-16-16v-13Z" fill="${fill}" />
     <path d="M84 122h13v49h-8c-6 0-10-4-10-10v-18c0-10 2-15 5-21Zm19 0h13c3 6 5 11 5 21v18c0 6-4 10-10 10h-8v-49Z" fill="${accent}" />`,
    `<path d="M76 108h48v14c0 8-6 15-15 15H91c-9 0-15-7-15-15v-14Z" fill="${fill}" />
     <path d="M83 122h14v50h-8c-7 0-11-4-11-11v-16c0-10 2-16 5-23Zm20 0h14c3 7 5 13 5 23v16c0 7-4 11-11 11h-8v-50Z" fill="${fill}" />`,
    `<path d="M75 108h50v13c0 9-6 16-15 16H90c-9 0-15-7-15-16v-13Z" fill="${fill}" />
     <path d="M84 122h13v50h-8c-7 0-11-4-11-11v-17c0-9 2-15 6-22Zm19 0h13c4 7 6 13 6 22v17c0 7-4 11-11 11h-8v-50Z" fill="${accent}" />`,
    `<path d="M74 108h52v15c0 8-7 14-15 14H89c-8 0-15-6-15-14v-15Z" fill="${fill}" />
     <path d="M81 113h38" stroke="${accent}" stroke-width="3" stroke-linecap="round" />
     <path d="M84 122h13v50h-8c-7 0-11-4-11-11v-16c0-10 2-16 6-23Zm19 0h13c4 7 6 13 6 23v16c0 7-4 11-11 11h-8v-50Z" fill="${fill}" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

function makeShoesSvg(fill: string, sole: string, variant: number) {
  const shapes = [
    `<path d="M79 169h11l12 6h11c8 0 15 3 20 10H73c1-8 3-13 6-16Z" fill="${fill}" />
     <path d="M105 169h11l12 6h11c8 0 15 3 20 10H99c1-8 3-13 6-16Z" fill="${fill}" />
     <path d="M73 185c8 2 22 3 36 3 15 0 29-1 36-3" stroke="${sole}" stroke-width="6" stroke-linecap="round" />
     <path d="M79 178h16l7-3m29 3h16l7-3" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
     <path d="M85 171h10m26 0h10" stroke="${sole}" stroke-width="2.5" stroke-linecap="round" opacity="0.8" />`,
    `<path d="M78 168h12l11 7h12c8 0 15 3 19 10H72c1-8 3-13 6-17Z" fill="${fill}" />
     <path d="M104 168h12l11 7h12c8 0 15 3 19 10H98c1-8 3-13 6-17Z" fill="${fill}" />
     <path d="M72 185c8 2 22 3 37 3 14 0 28-1 37-3" stroke="${sole}" stroke-width="5" stroke-linecap="round" />
     <path d="M80 177h18l6-3m28 3h18l6-3" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95" />
     <path d="M93 168v7m26-7v7" stroke="${sole}" stroke-width="3" stroke-linecap="round" />`,
    `<path d="M80 170h10l12 5h11c9 0 16 3 21 10H74c1-7 3-12 6-15Z" fill="${fill}" />
     <path d="M106 170h10l12 5h11c9 0 16 3 21 10H100c1-7 3-12 6-15Z" fill="${fill}" />
     <path d="M74 185c8 2 22 3 37 3 14 0 29-1 37-3" stroke="${sole}" stroke-width="5.5" stroke-linecap="round" />
     <path d="M83 178h8l7-3m33 3h8l7-3" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
     <path d="M80 181h18m28 0h18" stroke="${sole}" stroke-width="2.5" stroke-linecap="round" opacity="0.75" />`,
    `<path d="M78 169h11l12 6h12c8 0 15 3 20 10H72c1-8 3-13 6-16Z" fill="${fill}" />
     <path d="M104 169h11l12 6h12c8 0 15 3 20 10H98c1-8 3-13 6-16Z" fill="${fill}" />
     <path d="M72 185c8 2 22 3 37 3 14 0 29-1 37-3" stroke="${sole}" stroke-width="6" stroke-linecap="round" />
     <path d="M79 178h18l8-3m28 3h18l8-3" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
     <path d="M86 171h9m26 0h9" stroke="${sole}" stroke-width="2.4" stroke-linecap="round" opacity="0.75" />`,
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
