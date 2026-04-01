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
      <circle cx="100" cy="34" r="18" fill="${skin}" />
      <path d="M93 50h14v16c0 4-3 7-7 7s-7-3-7-7V50Z" fill="${skin}" />
      <path d="M87 64c3-3 8-5 13-5s10 2 13 5l10 43H77l10-43Z" fill="${skin}" />
      <path d="M77 70 60 92v8h12l13-14-8-16Zm46 0 17 22v8h-12l-13-14 8-16Z" fill="${skin}" />
      <path d="M90 107h9v63c0 8-6 14-14 14h-2v-9c0-5 2-9 5-12l2-56Zm11 0h9l2 56c3 3 5 7 5 12v9h-2c-8 0-14-6-14-14v-63Z" fill="${skin}" />
      <path d="M89 108h22" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" opacity="0.16" />
      <circle cx="100" cy="34" r="18" stroke="${accent}" stroke-width="2" opacity="0.16" />
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
    `<path d="M84 63c3-2 8-4 16-4s13 2 16 4l8 44H76l8-44Z" fill="${fill}" />
     <path d="M76 68 63 92v9h12l10-15-9-18Zm48 0 13 24v9h-12l-10-15 9-18Z" fill="${fill}" />
     <path d="M90 59h20l-4 9H94l-4-9Z" fill="${trim}" />
     <path d="M86 74 81 107m38-33 5 33" stroke="${trim}" stroke-width="2.5" stroke-linecap="round" opacity="0.65" />
     <path d="M92 77h16" stroke="${trim}" stroke-width="2.5" stroke-linecap="round" opacity="0.8" />`,
    `<path d="M83 63c4-2 9-4 17-4s13 2 17 4l7 45H76l7-45Z" fill="${fill}" />
     <path d="M76 69 62 92v9h12l11-15-9-17Zm48 0 14 23v9h-12l-11-15 9-17Z" fill="${fill}" />
     <path d="M95 59h10v49H95V59Z" fill="${trim}" opacity="0.95" />
     <path d="M90 59h20l-4 9H94l-4-9Z" fill="${trim}" />
     <path d="M85 74 80 108m40-34 5 34" stroke="${trim}" stroke-width="2.5" stroke-linecap="round" opacity="0.5" />`,
    `<path d="M84 63c3-2 8-4 16-4s13 2 16 4l8 44H76l8-44Z" fill="${fill}" />
     <path d="M76 68 63 91v10h12l10-14-9-19Zm48 0 13 23v10h-12l-10-14 9-19Z" fill="${fill}" />
     <path d="M90 59h20l-4 9H94l-4-9Z" fill="${trim}" />
     <rect x="87" y="79" width="26" height="17" rx="4" fill="${trim}" opacity="0.9" />
     <path d="M92 84h16M96 90h8" stroke="${fill}" stroke-width="2.4" stroke-linecap="round" />`,
    `<path d="M83 63c4-2 9-4 17-4s13 2 17 4l7 46H76l7-46Z" fill="${fill}" />
     <path d="M76 69 62 92v9h12l11-15-9-17Zm48 0 14 23v9h-12l-11-15 9-17Z" fill="${fill}" />
     <path d="M90 59h20l-4 9H94l-4-9Z" fill="${trim}" />
     <path d="M87 74 82 109m36-35 5 35" stroke="${trim}" stroke-width="2.5" stroke-linecap="round" opacity="0.7" />
     <path d="M91 82h18" stroke="${trim}" stroke-width="2.8" stroke-linecap="round" opacity="0.65" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

function makeBottomSvg(fill: string, accent: string, variant: number) {
  const shapes = [
    `<path d="M78 102h44v12c0 8-6 13-14 13H92c-8 0-14-5-14-13v-12Z" fill="${fill}" />
     <path d="M87 116h11v56h-7c-7 0-11-4-11-11v-18c0-9 2-17 7-27Zm15 0h11c5 10 7 18 7 27v18c0 7-4 11-11 11h-7v-56Z" fill="${accent}" />`,
    `<path d="M79 102h42v12c0 8-5 13-13 13H92c-8 0-13-5-13-13v-12Z" fill="${fill}" />
     <path d="M86 116h12v57h-7c-8 0-12-4-12-11v-18c0-11 3-20 7-28Zm16 0h12c4 8 7 17 7 28v18c0 7-4 11-12 11h-7v-57Z" fill="${fill}" />`,
    `<path d="M78 102h44v12c0 8-6 13-14 13H92c-8 0-14-5-14-13v-12Z" fill="${fill}" />
     <path d="M87 116h11v57h-7c-8 0-12-4-12-11v-19c0-10 3-18 8-27Zm15 0h11c5 9 8 17 8 27v19c0 7-4 11-12 11h-7v-57Z" fill="${accent}" />`,
    `<path d="M78 102h44v13c0 7-6 12-13 12H91c-7 0-13-5-13-12v-13Z" fill="${fill}" />
     <path d="M84 107h32" stroke="${accent}" stroke-width="3" stroke-linecap="round" />
     <path d="M87 116h11v57h-7c-8 0-12-4-12-11v-18c0-11 3-20 8-28Zm15 0h11c5 8 8 17 8 28v18c0 7-4 11-12 11h-7v-57Z" fill="${fill}" />`,
  ]

  return toDataUri(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none">
      ${shapes[variant]}
    </svg>
  `)
}

function makeShoesSvg(fill: string, sole: string, variant: number) {
  const shapes = [
    `<path d="M82 171h9l11 5h10c8 0 14 3 18 9H74c2-7 4-11 8-14Z" fill="${fill}" />
     <path d="M108 171h9l11 5h10c8 0 14 3 18 9H100c2-7 4-11 8-14Z" fill="${fill}" />
     <path d="M74 184h56c-3 3-14 5-28 5s-25-2-28-5Zm26 0h56c-3 3-14 5-28 5s-25-2-28-5Z" fill="${sole}" />
     <path d="M83 177h14l6-2m29 2h14l6-2" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
     <path d="M88 170h9m26 0h9" stroke="${sole}" stroke-width="2.2" stroke-linecap="round" opacity="0.8" />`,
    `<path d="M81 170h10l10 6h11c8 0 14 3 18 9H73c2-7 4-11 8-15Z" fill="${fill}" />
     <path d="M107 170h10l10 6h11c8 0 14 3 18 9H99c2-7 4-11 8-15Z" fill="${fill}" />
     <path d="M73 184h57c-4 3-15 5-29 5s-25-2-28-5Zm26 0h57c-4 3-15 5-29 5s-25-2-28-5Z" fill="${sole}" />
     <path d="M84 176h16l5-2m29 2h16l5-2" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.95" />
     <path d="M94 170v6m26-6v6" stroke="${sole}" stroke-width="2.8" stroke-linecap="round" />`,
    `<path d="M83 172h8l11 4h10c9 0 15 3 19 9H75c2-6 4-10 8-13Z" fill="${fill}" />
     <path d="M109 172h8l11 4h10c9 0 15 3 19 9h-56c2-6 4-10 8-13Z" fill="${fill}" />
     <path d="M75 184h56c-4 3-15 5-28 5-14 0-25-2-28-5Zm26 0h56c-4 3-15 5-28 5-14 0-25-2-28-5Z" fill="${sole}" />
     <path d="M86 177h8l7-2m33 2h8l7-2" stroke="#ffffff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
     <path d="M84 180h18m28 0h18" stroke="${sole}" stroke-width="2.3" stroke-linecap="round" opacity="0.75" />`,
    `<path d="M81 171h9l11 5h11c8 0 14 3 18 9H73c2-7 4-11 8-14Z" fill="${fill}" />
     <path d="M107 171h9l11 5h11c8 0 14 3 18 9H99c2-7 4-11 8-14Z" fill="${fill}" />
     <path d="M73 184h57c-4 3-15 5-29 5s-25-2-28-5Zm26 0h57c-4 3-15 5-29 5s-25-2-28-5Z" fill="${sole}" />
     <path d="M84 177h16l7-2m28 2h16l7-2" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
     <path d="M90 170h8m26 0h8" stroke="${sole}" stroke-width="2.2" stroke-linecap="round" opacity="0.75" />`,
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
