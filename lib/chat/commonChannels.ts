export const COMMON_CHANNEL_KEYS = ['reports', 'social', 'important_info'] as const

export type CommonChannelKey = (typeof COMMON_CHANNEL_KEYS)[number]
export const IMPORTANT_INFO_CHANNEL_KEY = 'important_info' as const

export const COMMON_CHANNEL_TITLE_BY_KEY: Record<CommonChannelKey, string> = {
  reports: 'Отчеты',
  social: 'Общение',
  important_info: 'Важная информация',
}

export function isCommonChannelKey(value: string | null | undefined): value is CommonChannelKey {
  return COMMON_CHANNEL_KEYS.includes(value as CommonChannelKey)
}

export function getCommonChannelTitle(channelKey: string | null | undefined) {
  if (!isCommonChannelKey(channelKey)) {
    return null
  }

  return COMMON_CHANNEL_TITLE_BY_KEY[channelKey]
}
