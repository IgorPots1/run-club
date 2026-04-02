type RequestJwtPayload = {
  sub?: unknown
  exp?: unknown
  role?: unknown
}

function looksLikeJwt(value: string) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function safeDecodeBase64Url(value: string) {
  try {
    return Buffer.from(value, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function extractJwtFromSessionValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmedValue = value.trim()

    if (!trimmedValue) {
      return null
    }

    if (looksLikeJwt(trimmedValue)) {
      return trimmedValue
    }

    const decodedValue = safeDecodeURIComponent(trimmedValue)

    if (looksLikeJwt(decodedValue)) {
      return decodedValue
    }

    if (decodedValue.startsWith('base64-')) {
      const base64DecodedValue = safeDecodeBase64Url(decodedValue.slice('base64-'.length))

      if (base64DecodedValue) {
        const nestedJwt = extractJwtFromSessionValue(base64DecodedValue)

        if (nestedJwt) {
          return nestedJwt
        }
      }
    }

    try {
      return extractJwtFromSessionValue(JSON.parse(decodedValue))
    } catch {
      return null
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const jwt = extractJwtFromSessionValue(item)

      if (jwt) {
        return jwt
      }
    }

    return null
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>

    if (typeof record.access_token === 'string' && looksLikeJwt(record.access_token)) {
      return record.access_token
    }

    for (const nestedValue of Object.values(record)) {
      const jwt = extractJwtFromSessionValue(nestedValue)

      if (jwt) {
        return jwt
      }
    }
  }

  return null
}

function readSupabaseJwtFromCookies(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? ''

  if (!cookieHeader) {
    return null
  }

  const cookieEntries = cookieHeader
    .split(';')
    .map((part) => {
      const separatorIndex = part.indexOf('=')

      if (separatorIndex === -1) {
        return null
      }

      return {
        name: part.slice(0, separatorIndex).trim(),
        value: part.slice(separatorIndex + 1).trim(),
      }
    })
    .filter((entry): entry is { name: string; value: string } => Boolean(entry))

  const groupedCookieValues = new Map<string, Array<{ index: number; value: string }>>()

  for (const entry of cookieEntries) {
    const match = entry.name.match(/^(sb-[A-Za-z0-9_-]+-auth-token)(?:\.(\d+))?$/)

    if (!match) {
      continue
    }

    const baseName = match[1] ?? entry.name
    const index = match[2] ? Number.parseInt(match[2], 10) : 0
    const existingEntries = groupedCookieValues.get(baseName) ?? []
    existingEntries.push({ index, value: entry.value })
    groupedCookieValues.set(baseName, existingEntries)
  }

  for (const entries of groupedCookieValues.values()) {
    const serializedValue = entries
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.value)
      .join('')
    const jwt = extractJwtFromSessionValue(serializedValue)

    if (jwt) {
      return jwt
    }
  }

  return null
}

function readRequestJwt(request: Request) {
  const authorizationHeader = request.headers.get('authorization')?.trim() ?? ''

  if (authorizationHeader.toLowerCase().startsWith('bearer ')) {
    const bearerToken = authorizationHeader.slice(7).trim()

    if (looksLikeJwt(bearerToken)) {
      return bearerToken
    }
  }

  return readSupabaseJwtFromCookies(request)
}

export function decodeRequestUserId(request: Request) {
  const token = readRequestJwt(request)

  if (!token) {
    return null
  }

  const payloadSegment = token.split('.')[1]

  if (!payloadSegment) {
    return null
  }

  let payload: RequestJwtPayload

  try {
    payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as RequestJwtPayload
  } catch {
    return null
  }

  const userId = typeof payload.sub === 'string' ? payload.sub.trim() : ''
  const expirationTimestamp = typeof payload.exp === 'number' ? payload.exp : null
  const role = typeof payload.role === 'string' ? payload.role : null

  if (!userId) {
    return null
  }

  if (expirationTimestamp !== null && expirationTimestamp * 1000 <= Date.now()) {
    return null
  }

  if (role !== null && role !== 'authenticated') {
    return null
  }

  return userId
}
