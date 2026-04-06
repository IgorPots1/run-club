import Link from 'next/link'
import { redirect } from 'next/navigation'
import WorkoutDetailShell from '@/components/WorkoutDetailShell'
import {
  loadInboxEventItems,
  markInboxEventsAsRead,
  type InboxListItem,
} from '@/lib/app-events'
import { formatRunDateTimeLabel } from '@/lib/format'
import { getAuthenticatedUser } from '@/lib/supabase-server'

function getEventBadgeLabel(actorName: string | null, eventType: string) {
  const trimmed = actorName?.trim()

  if (trimmed) {
    return trimmed[0]?.toUpperCase() ?? 'R'
  }

  if (eventType === 'challenge.completed') {
    return 'C'
  }

  return 'R'
}

function formatGroupedRunLikeTitle(item: Extract<InboxListItem, { type: 'grouped_run_like' }>) {
  const [firstActorName = 'Кто-то', secondActorName = 'кто-то'] = item.actorPreviewNames

  if (item.actorCount <= 1) {
    return item.title
  }

  if (item.actorCount === 2) {
    return `${firstActorName} и ${secondActorName} лайкнули вашу пробежку`
  }

  return `${firstActorName}, ${secondActorName} и еще ${item.actorCount - 2} чел. лайкнули вашу пробежку`
}

export default async function ActivityInboxPage() {
  const { user, error } = await getAuthenticatedUser()

  if (error || !user) {
    redirect('/login')
  }

  let events = null as Awaited<ReturnType<typeof loadInboxEventItems>> | null
  let loadFailed = false

  try {
    ;[events] = await Promise.all([
      loadInboxEventItems(user.id),
      // Do not block inbox rendering if the read cursor update fails.
      markInboxEventsAsRead(user.id).catch((error) => {
        console.error('Failed to mark inbox events as read', {
          userId: user.id,
          error: error instanceof Error ? error.message : 'unknown_error',
        })
      }),
    ])
  } catch {
    loadFailed = true
  }

  return (
    <WorkoutDetailShell title="Входящие" fallbackHref="/activity">
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
            const actorName = event.type === 'grouped_run_like'
              ? null
              : event.actorName
            const actorAvatarUrl = event.type === 'grouped_run_like'
              ? event.actorPreviewAvatarUrls[0] ?? null
              : event.actorAvatarUrl
            const eventType = event.type === 'grouped_run_like'
              ? 'run_like.created'
              : event.type
            const title = event.type === 'grouped_run_like'
              ? formatGroupedRunLikeTitle(event)
              : event.title
            const cardContent = (
              <div className="flex items-start gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/[0.05] text-sm font-semibold text-black/70 dark:bg-white/[0.08] dark:text-white/80">
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

                <div className="min-w-0 flex-1">
                  {actorName ? (
                    <p className="app-text-primary text-sm font-semibold leading-5">{actorName}</p>
                  ) : null}
                  <p className={`app-text-primary text-sm leading-5 ${actorName ? 'mt-px' : ''}`}>
                    {title}
                  </p>
                  {event.body ? (
                    <p className="app-text-secondary mt-0.5 text-sm leading-5">{event.body}</p>
                  ) : null}
                  <p className="app-text-secondary mt-1 text-xs">{formatRunDateTimeLabel(event.createdAt)}</p>
                </div>
              </div>
            )

            if (event.targetPath) {
              return (
                <Link
                  key={event.id}
                  href={event.targetPath}
                  className="app-card app-surface-muted block rounded-xl border border-black/[0.05] p-3 shadow-sm transition-transform transition-shadow hover:shadow-md active:scale-[0.99] dark:border-white/[0.08]"
                >
                  {cardContent}
                </Link>
              )
            }

            return (
              <div
                key={event.id}
                className="app-card app-surface-muted rounded-xl border border-black/[0.05] p-3 shadow-sm dark:border-white/[0.08]"
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
