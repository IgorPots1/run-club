'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import { dispatchInboxUnreadUpdated } from '@/lib/app-events-client'
import { formatRunDateTimeLabel } from '@/lib/format'
import { useRunDetailReturnState } from '@/lib/run-detail-navigation'

type ActivityInboxEventItem = {
  id: string
  type: string
  createdAt: string
  isUnread: boolean
  targetPath: string | null
  actorName: string | null
  actorAvatarUrl: string | null
  title: string
  body: string | null
}

type ActivityGroupedRunLikeInboxItem = {
  id: string
  type: 'grouped_run_like'
  createdAt: string
  isUnread: boolean
  targetPath: string | null
  actorCount: number
  actorPreviewNames: string[]
  actorPreviewAvatarUrls: string[]
  title: string
  body: string | null
}

type ActivityInboxListItem =
  | ActivityInboxEventItem
  | ActivityGroupedRunLikeInboxItem

type ActivityInboxClientProps = {
  loadFailed: boolean
  didMarkEventsAsRead: boolean
  events: ActivityInboxListItem[] | null
}

const RUN_DETAIL_PATH_PATTERN = /^\/runs\/[^/]+$/

function getEventBadgeLabel(actorName: string | null, eventType: string) {
  const trimmed = actorName?.trim()

  if (trimmed) {
    return trimmed[0]?.toUpperCase() ?? 'R'
  }

  if (eventType === 'challenge.completed') {
    return 'C'
  }

  if (eventType === 'race_event.created' || eventType === 'race_event.completed') {
    return 'R'
  }

  return 'R'
}

function formatGroupedRunLikeTitle(item: ActivityGroupedRunLikeInboxItem) {
  const [firstActorName = 'Кто-то', secondActorName = 'кто-то'] = item.actorPreviewNames

  if (item.actorCount <= 1) {
    return item.title
  }

  if (item.actorCount === 2) {
    return `${firstActorName} и ${secondActorName} лайкнули вашу пробежку`
  }

  return `${firstActorName}, ${secondActorName} и еще ${item.actorCount - 2} чел. лайкнули вашу пробежку`
}

function formatGroupedRunLikeParts(item: ActivityGroupedRunLikeInboxItem) {
  const [firstActorName = 'Кто-то', secondActorName = 'кто-то'] = item.actorPreviewNames

  if (item.actorCount <= 1) {
    return null
  }

  if (item.actorCount === 2) {
    return {
      actorText: `${firstActorName} и ${secondActorName}`,
      actionText: 'лайкнули вашу пробежку',
    }
  }

  return {
    actorText: `${firstActorName}, ${secondActorName} и еще ${item.actorCount - 2} чел.`,
    actionText: 'лайкнули вашу пробежку',
  }
}

function isGroupedRunLikeInboxItem(event: ActivityInboxListItem): event is ActivityGroupedRunLikeInboxItem {
  return event.type === 'grouped_run_like'
}

function getInitialLabel(name: string | null | undefined) {
  const trimmed = name?.trim()
  return trimmed?.[0]?.toUpperCase() ?? 'R'
}

function getActionIcon(eventType: string) {
  if (eventType.includes('like')) {
    return '❤'
  }

  if (eventType.includes('comment') || eventType.includes('reply')) {
    return '💬'
  }

  return null
}

function ensureTrailingColon(text: string) {
  return `${text.replace(/[:\s]+$/u, '')}:`
}

export default function ActivityInboxClient({
  loadFailed,
  didMarkEventsAsRead,
  events,
}: ActivityInboxClientProps) {
  const router = useRouter()
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const { prepareForRunDetailNavigation } = useRunDetailReturnState({
    sourceKey: 'activity-inbox',
    scrollContainerRef,
    debugLabel: 'ActivityInbox',
  })

  useEffect(() => {
    if (!didMarkEventsAsRead) {
      return
    }

    dispatchInboxUnreadUpdated()
  }, [didMarkEventsAsRead])

  function handleOpenRunDetail(targetPath: string) {
    prepareForRunDetailNavigation()
    router.push(targetPath)
  }

  return (
    <WorkoutDetailShell
      title="Входящие"
      fallbackHref="/activity"
      pinnedHeader
      scrollContainerRef={scrollContainerRef}
    >
      {loadFailed ? (
        <div className="app-card rounded-xl border p-4 shadow-sm">
          <p className="text-sm text-red-600">Не удалось загрузить входящие</p>
          <Link href="/activity" className="app-button-secondary mt-4 inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm">
            Вернуться в активность
          </Link>
        </div>
      ) : !events || events.length === 0 ? (
        <div className="app-card rounded-xl border p-5 text-center shadow-sm md:p-6">
          <p className="app-text-secondary text-sm">Пока здесь пусто.</p>
          <p className="app-text-secondary mt-2 text-sm">Когда кто-то отреагирует на ваши пробежки или выполнится челлендж, событие появится здесь.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => {
            let groupedRunLikeEvent: ActivityGroupedRunLikeInboxItem | null = null
            let actorName: string | null
            let actorAvatarUrl: string | null
            let eventType: string
            let title: string

            if (isGroupedRunLikeInboxItem(event)) {
              groupedRunLikeEvent = event
              actorName = null
              actorAvatarUrl = event.actorPreviewAvatarUrls[0] ?? null
              eventType = 'run_like.created'
              title = formatGroupedRunLikeTitle(event)
            } else {
              actorName = event.actorName
              actorAvatarUrl = event.actorAvatarUrl
              eventType = event.type
              title = event.title
            }
            const groupedLikeParts = groupedRunLikeEvent ? formatGroupedRunLikeParts(groupedRunLikeEvent) : null
            const actionIcon = getActionIcon(eventType)
            const firstLineTitle = ensureTrailingColon(title)
            const secondLineText = groupedLikeParts
              ? `${groupedLikeParts.actorText} ${groupedLikeParts.actionText}`
              : event.body ?? title
            const cardContent = (
              <div className="flex items-start gap-3">
                <div className="w-12 min-w-12 flex items-start">
                  {groupedRunLikeEvent ? (
                    <div className="flex -space-x-2">
                      {[0, 1].map((index) => {
                        const previewAvatarUrl = groupedRunLikeEvent.actorPreviewAvatarUrls[index] ?? null
                        const previewName = groupedRunLikeEvent.actorPreviewNames[index] ?? null

                        if (!previewAvatarUrl && !previewName) {
                          return null
                        }

                        return (
                          <div
                            key={`${groupedRunLikeEvent.id}-avatar-${index}`}
                            className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-[color:var(--background)] bg-black/[0.05] text-[11px] font-semibold text-black/70 dark:bg-white/[0.08] dark:text-white/80"
                          >
                            {previewAvatarUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={previewAvatarUrl}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span>{getInitialLabel(previewName)}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-black/[0.05] text-sm font-semibold text-black/70 dark:bg-white/[0.08] dark:text-white/80">
                      {actorAvatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={actorAvatarUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span>{getEventBadgeLabel(actorName, eventType)}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 flex flex-col gap-1">
                  <p className="app-text-primary truncate text-sm font-semibold leading-5">{firstLineTitle}</p>
                  <div className="flex items-start gap-1">
                    {actionIcon ? (
                      <span aria-hidden="true" className="app-text-secondary inline-flex h-5 w-4 shrink-0 items-start justify-center text-[12px] leading-5">
                        {actionIcon}
                      </span>
                    ) : (
                      <span aria-hidden="true" className="h-5 w-4 shrink-0" />
                    )}
                    <p
                      className={`app-text-primary min-w-0 flex-1 text-sm leading-5 ${
                        groupedRunLikeEvent ? 'line-clamp-2' : 'line-clamp-1'
                      } ${event.isUnread ? 'font-medium' : ''}`}
                    >
                      {secondLineText}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <p className="app-text-secondary text-xs leading-4">{formatRunDateTimeLabel(event.createdAt)}</p>
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full bg-sky-500 dark:bg-sky-400 ${
                        event.isUnread ? 'opacity-100' : 'opacity-0'
                      }`}
                    />
                  </div>
                </div>
              </div>
            )

            if (typeof event.targetPath === 'string' && RUN_DETAIL_PATH_PATTERN.test(event.targetPath)) {
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => handleOpenRunDetail(event.targetPath!)}
                  className="app-card app-surface-muted block w-full rounded-xl border border-black/[0.05] px-3.5 py-3 text-left shadow-sm transition-transform transition-shadow hover:shadow-md active:scale-[0.99] dark:border-white/[0.08]"
                >
                  {cardContent}
                </button>
              )
            }

            if (event.targetPath) {
              return (
                <Link
                  key={event.id}
                  href={event.targetPath}
                  className="app-card app-surface-muted block rounded-xl border border-black/[0.05] px-3.5 py-3 shadow-sm transition-transform transition-shadow hover:shadow-md active:scale-[0.99] dark:border-white/[0.08]"
                >
                  {cardContent}
                </Link>
              )
            }

            return (
              <div
                key={event.id}
                className="app-card app-surface-muted rounded-xl border border-black/[0.05] px-3.5 py-3 shadow-sm dark:border-white/[0.08]"
              >
                {cardContent}
              </div>
            )
          })}
        </div>
      )}
    </WorkoutDetailShell>
  )
}
